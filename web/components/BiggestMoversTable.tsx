'use client';

import { useEffect, useState } from 'react';
import { computeMovers, MOVER_METRICS, DistrictMover } from '@/lib/trendMovers';

const CITY_LABELS: Record<'stpaul' | 'mpls', string> = { stpaul: 'St. Paul', mpls: 'Minneapolis' };

function MoverRow({ mover, config }: { mover: DistrictMover; config: (typeof MOVER_METRICS)[number] }) {
  const improved = config.inverted ? mover.pctChange < 0 : mover.pctChange > 0;
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #eee', fontSize: '13px' }}>
      <div>
        <div style={{ fontWeight: 600 }}>{mover.districtName}</div>
        <div style={{ fontSize: '11px', color: '#999' }}>
          {CITY_LABELS[mover.city]} · {config.format(mover.firstValue)} ({mover.firstYear}) to {config.format(mover.lastValue)} ({mover.lastYear})
        </div>
      </div>
      <div style={{ fontWeight: 700, color: improved ? '#2a9d5c' : '#c0392b' }}>
        {mover.pctChange >= 0 ? '+' : ''}{mover.pctChange.toFixed(0)}%
      </div>
    </div>
  );
}

export default function BiggestMoversTable() {
  const [metricKey, setMetricKey] = useState(MOVER_METRICS[0].key);
  const [movers, setMovers] = useState<DistrictMover[] | null>(null);

  useEffect(() => {
    setMovers(null);
    computeMovers(metricKey).then(setMovers);
  }, [metricKey]);

  const config = MOVER_METRICS.find((m) => m.key === metricKey)!;
  const topImproved = movers ? (config.inverted ? movers.slice(-5).reverse() : movers.slice(0, 5)) : [];
  const topWorsened = movers ? (config.inverted ? movers.slice(0, 5) : movers.slice(-5).reverse()) : [];

  return (
    <div>
      <select
        value={metricKey}
        onChange={(e) => setMetricKey(e.target.value)}
        style={{ padding: '6px 10px', fontSize: '13px', borderRadius: '4px', border: '1px solid #ccc', marginBottom: '16px' }}
      >
        {MOVER_METRICS.map((m) => (
          <option key={m.key} value={m.key}>{m.label}</option>
        ))}
      </select>

      {!movers ? (
        <div style={{ color: '#999', fontSize: '13px' }}>Loading…</div>
      ) : movers.length === 0 ? (
        <div style={{ color: '#999', fontSize: '13px' }}>No data available for this metric.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(320px, 100%), 1fr))', gap: '16px' }}>
          <div>
            <div style={{ fontSize: '12px', fontWeight: 700, color: '#2a9d5c', marginBottom: '8px' }}>
              Most improved
            </div>
            {topImproved.map((m) => <MoverRow key={`${m.city}-${m.districtId}`} mover={m} config={config} />)}
          </div>
          <div>
            <div style={{ fontSize: '12px', fontWeight: 700, color: '#c0392b', marginBottom: '8px' }}>
              Most worsened
            </div>
            {topWorsened.map((m) => <MoverRow key={`${m.city}-${m.districtId}`} mover={m} config={config} />)}
          </div>
        </div>
      )}
    </div>
  );
}
