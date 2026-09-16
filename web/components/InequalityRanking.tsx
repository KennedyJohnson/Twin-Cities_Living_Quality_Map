'use client';

import { useEffect, useState } from 'react';
import { loadNeighborhoodData } from '@/lib/loadNeighborhoodData';

interface AffordabilityFile {
  acs_year: number;
  districts: Record<string, { gini_index: number | null }>;
}

interface Row {
  district_id: number;
  district_name: string;
  gini_index: number;
}

async function loadRows(city: 'stpaul' | 'mpls'): Promise<Row[]> {
  const [affordability, neighborhoods] = await Promise.all([
    fetch(`/data/affordability_${city}.json`).then((r) => r.json() as Promise<AffordabilityFile>),
    loadNeighborhoodData(city),
  ]);
  const nameById = new Map(neighborhoods.neighborhoods.map((n) => [n.district_id, n.district_name]));
  const rows: Row[] = [];
  for (const [idStr, data] of Object.entries(affordability.districts)) {
    if (data.gini_index == null) continue;
    const district_id = Number(idStr);
    rows.push({
      district_id,
      district_name: nameById.get(district_id) ?? idStr,
      gini_index: data.gini_index,
    });
  }
  return rows;
}

export default function InequalityRanking({ onSelectDistrict }: { onSelectDistrict?: (districtId: number) => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    Promise.all([loadRows('stpaul'), loadRows('mpls')])
      .then(([stpaul, mpls]) => setRows([...stpaul, ...mpls].sort((a, b) => b.gini_index - a.gini_index)))
      .catch(() => setRows([]));
  }, []);

  if (!rows) return <div style={{ fontSize: '12px', color: '#999' }}>Loading…</div>;
  if (rows.length === 0) return <div style={{ fontSize: '12px', color: '#999' }}>No Gini index data available.</div>;

  const maxGini = Math.max(...rows.map((r) => r.gini_index));

  return (
    <div>
      {rows.map((row, i) => (
        <div
          key={row.district_id}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            marginBottom: '6px',
            cursor: onSelectDistrict ? 'pointer' : undefined,
          }}
          onClick={() => onSelectDistrict?.(row.district_id)}
        >
          <div style={{ width: '20px', fontSize: '11px', color: '#999', textAlign: 'right', flexShrink: 0 }}>
            {i + 1}
          </div>
          <div style={{ width: '170px', fontSize: '12px', flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {row.district_name}
          </div>
          <div style={{ flex: 1, background: '#f0f0f2', borderRadius: '3px', height: '14px', position: 'relative' }}>
            <div
              style={{
                width: `${(row.gini_index / maxGini) * 100}%`,
                background: '#756bb1',
                height: '100%',
                borderRadius: '3px',
              }}
            />
          </div>
          <div style={{ width: '48px', fontSize: '12px', fontWeight: 600, textAlign: 'right', flexShrink: 0 }}>
            {row.gini_index.toFixed(3)}
          </div>
        </div>
      ))}
    </div>
  );
}
