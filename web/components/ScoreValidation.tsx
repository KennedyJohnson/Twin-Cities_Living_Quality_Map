import v from '@/public/data/score_validation.json';

const LABELS: Record<string, string> = {
  safety: 'Safety', opportunity: 'Opportunity', amenities: 'Amenities & Services',
  transportation: 'Transportation', affordability: 'Economic Profile',
};
const pct = (x: number) => `${Math.round(x * 100)}%`;
const pval = (p: number) => (p < 0.001 ? 'p < 0.001' : `p = ${p.toFixed(2)}`);

export default function ScoreValidation() {
  const s = v.sensitivity;
  const home = v.external.outcomes.find((o) => o.outcome === 'median_home_value')!;
  const rent = v.external.outcomes.find((o) => o.outcome === 'median_gross_rent')!;
  return (
    <div>
      <h2 style={{ fontSize: '18px', fontWeight: 700, margin: '32px 0 8px' }}>Does the ranking depend on the weights?</h2>
      <p style={{ marginBottom: '12px' }}>
        The five components are weighted 20% each, which is a judgment call. We re-ranked the districts under{' '}
        {s.draws.toLocaleString()} random alternative weightings (each weight usually between about 5% and 40%). The
        alternative rankings agree closely with the published one (average Spearman correlation {s.spearman_mean}; 95%
        of them at least {s.spearman_p5}). The top district stays #1 in {pct(s.top_district_stays_first)} of them.
        A typical district&apos;s rank moves within a band of about {s.median_rank_band} places. Dropping any one
        component entirely leaves the ranking at a correlation of{' '}
        {Math.min(...Object.values(s.drop_one_component_spearman))} or higher.
      </p>
      <details style={{ marginBottom: '10px' }}>
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Rank range for each district</summary>
        <table style={{ fontSize: '13px', borderCollapse: 'collapse', margin: '8px 0', width: '100%' }}>
          <thead>
            <tr style={{ textAlign: 'left', color: '#555' }}>
              <th>District</th><th>Published rank</th><th>Range under other weights (90%)</th>
            </tr>
          </thead>
          <tbody>
            {s.districts.map((d) => (
              <tr key={d.id} style={{ borderTop: '1px solid #eee' }}>
                <td>{d.name} <span style={{ color: '#888' }}>({d.city === 'mpls' ? 'Minneapolis' : 'St. Paul'})</span></td>
                <td>{d.rank}</td>
                <td>{d.rank_p5 === d.rank_p95 ? d.rank_p5 : `${d.rank_p5}–${d.rank_p95}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>

      <h2 style={{ fontSize: '18px', fontWeight: 700, margin: '32px 0 8px' }}>Does the market agree?</h2>
      <p style={{ marginBottom: '12px' }}>
        If the score captures things people value, housing prices should reflect them. Home values and rent feed the
        Economic Profile component, so this uses the other four components only. Across the {v.external.n} districts, a
        higher non-price score goes with higher home values (Spearman {home.spearman}, {pval(home.perm_p)} by
        permutation test). Part of that is income, because richer areas both pay more and score higher. Holding household
        income fixed, the link weakens to {home.partial_spearman_given_income}. Rent shows almost no relationship
        (Spearman {rent.spearman}, {pval(rent.perm_p)}). The Opportunity component actually runs <i>opposite</i> to
        rent ({rent.by_component.opportunity}). So the score lines up with what buyers pay, but
        with 28 districts it&apos;s a sanity check, not proof.
      </p>
      <div style={{ fontSize: '13px', color: '#555' }}>
        Correlation of each component with median home value:{' '}
        {Object.entries(home.by_component).map(([k, r]) => `${LABELS[k]} ${r}`).join(' · ')}
      </div>
    </div>
  );
}
