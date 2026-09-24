'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

// Month-by-month score history for one district/ZIP, from the Supabase
// area_snapshots table that each monthly refresh appends to (see
// pipeline/exports/export_supabase.py). Renders nothing if Supabase isn't
// configured or there's no history for the area.

const SERIES = [
  { key: 'health_score', label: 'Overall' },
  { key: 'safety', label: 'Safety' },
  { key: 'opportunity', label: 'Opportunity' },
  { key: 'amenities', label: 'Amenities' },
  { key: 'transportation', label: 'Transportation' },
  { key: 'economic_profile', label: 'Economic Profile' },
] as const;

type SeriesKey = (typeof SERIES)[number]['key'];
type Snapshot = Record<SeriesKey, number | null> & { refresh_runs: { run_at: string } };

const W = 110;
const H = 24;

function Sparkline({ values }: { values: (number | null)[] }) {
  const pts = values
    .map((v, i) => (v == null ? null : [i, v] as const))
    .filter((p): p is readonly [number, number] => p != null);
  if (pts.length < 2) return <svg width={W} height={H} />;
  const ys = pts.map((p) => p[1]);
  const lo = Math.min(...ys) - 2;
  const hi = Math.max(...ys) + 2;
  const x = (i: number) => (i / (values.length - 1)) * (W - 4) + 2;
  const y = (v: number) => H - 2 - ((v - lo) / (hi - lo)) * (H - 4);
  const d = pts.map(([i, v], n) => `${n ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const [li, lv] = pts[pts.length - 1];
  return (
    <svg width={W} height={H} aria-hidden="true">
      <path d={d} fill="none" stroke="#4a6fa5" strokeWidth={1.5} />
      <circle cx={x(li)} cy={y(lv)} r={2.5} fill="#4a6fa5" />
    </svg>
  );
}

export default function ScoreHistoryChart({ areaType, areaId }: { areaType: 'district' | 'zip'; areaId: number }) {
  const [rows, setRows] = useState<Snapshot[] | null>(null);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    setRows(null);
    supabase
      .from('area_snapshots')
      .select(`${SERIES.map((s) => s.key).join(',')},refresh_runs(run_at)`)
      .eq('area_type', areaType)
      .eq('area_id', areaId)
      .order('run_id')
      .then(({ data, error }) => {
        if (!cancelled && !error) setRows((data as unknown as Snapshot[]) ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, [areaType, areaId]);

  if (!rows || rows.length === 0) return null;

  const fmt = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  const first = rows[0].refresh_runs.run_at;
  const last = rows[rows.length - 1].refresh_runs.run_at;

  return (
    <div style={{ marginBottom: '20px' }}>
      <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '6px', color: '#666' }}>
        Score History{' '}
        <span style={{ fontWeight: 400, color: '#999' }}>
          ({rows.length === 1 ? `tracking since ${fmt(first)}` : `${fmt(first)} – ${fmt(last)}`})
        </span>
      </div>
      {rows.length === 1 ? (
        <div style={{ fontSize: '12px', color: '#999' }}>
          Trends will appear here after the next monthly data refresh.
        </div>
      ) : (
        <table style={{ width: '100%', fontSize: '12px', borderCollapse: 'collapse' }}>
          <tbody>
            {SERIES.map(({ key, label }) => {
              const values = rows.map((r) => (r[key] == null ? null : Number(r[key])));
              const known = values.filter((v): v is number => v != null);
              if (known.length === 0) return null;
              const delta = known.length > 1 ? known[known.length - 1] - known[0] : 0;
              return (
                <tr key={key}>
                  <td style={{ padding: '2px 0', fontWeight: key === 'health_score' ? 600 : 400 }}>{label}</td>
                  <td style={{ padding: '2px 4px' }}>
                    <Sparkline values={values} />
                  </td>
                  <td style={{ padding: '2px 0', textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {Math.round(known[known.length - 1])}{' '}
                    <span style={{ color: delta > 0 ? '#2e7d32' : delta < 0 ? '#c62828' : '#999' }}>
                      {delta > 0 ? '+' : ''}
                      {Math.round(delta)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
