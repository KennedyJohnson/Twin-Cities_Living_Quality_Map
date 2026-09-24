import drivers from '@/public/data/score_drivers.json';

type Driver = { label: string; share_pct: number; mean_abs_shap: number; direction: string };
type Result = { loo_r2: number; drivers: Driver[] };

const SECTIONS: [keyof typeof drivers, string][] = [
  ['total', 'Overall Living Quality Score'],
  ['safety', 'Safety'],
  ['opportunity', 'Opportunity'],
  ['amenities', 'Amenities & Services'],
  ['transportation', 'Transportation'],
  ['affordability', 'Economic Profile'],
];

function DriverBars({ result, limit }: { result: Result; limit?: number }) {
  const rows = result.drivers.slice(0, limit);
  const max = Math.max(...rows.map((d) => d.share_pct));
  return (
    <div style={{ fontSize: '13px', margin: '8px 0 4px' }}>
      {rows.map((d) => (
        <div key={d.label} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
          <span style={{ width: '170px', flexShrink: 0 }}>
            {d.label} <span style={{ color: '#888' }}>({d.direction === '+' ? 'higher = better' : 'higher = worse'})</span>
          </span>
          <div style={{ flex: 1, background: '#eee', borderRadius: '3px', height: '12px' }}>
            <div style={{ width: `${(100 * d.share_pct) / max}%`, background: '#756bb1', height: '100%', borderRadius: '3px' }} />
          </div>
          <span style={{ minWidth: '110px', textAlign: 'right', color: '#555', whiteSpace: 'nowrap' }}>
            {d.share_pct}% · ±{d.mean_abs_shap} pts
          </span>
        </div>
      ))}
      <div style={{ color: '#888', fontSize: '12px' }}>Surrogate fit: leave-one-out R² = {result.loo_r2}</div>
    </div>
  );
}

export default function ScoreDrivers() {
  return (
    <div>
      {SECTIONS.map(([key, title], i) => (
        <details key={key} open={i === 0} style={{ marginBottom: '10px' }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>{title}</summary>
          <DriverBars result={drivers[key] as Result} limit={key === 'total' ? 12 : undefined} />
        </details>
      ))}
    </div>
  );
}
