'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Cell } from 'recharts';

type ModelPoint = Record<string, number | string>;

interface Summary {
  model: string;
  mean_rmse: number;
  std_rmse: number;
  pooled_r2: number;
  by_city?: Record<string, { rmse: number; mape: number; n: number }>;
  folds?: { test_year: number; rmse: number }[];
}

interface Results {
  generated_from: { panel_years: number[]; n_districts: number; n_transitions: number; test_transition: string };
  feature_selection: { candidates: string[]; selected: string[] };
  model_bakeoff: Summary[];
  naive_baselines?: Summary[];
  predictions: { city: string; district_id: number; actual: number; preds: Record<string, number> }[];
  learning_curve_features: ModelPoint[];
}

const MODEL = 'Lasso';
const NAIVE = 'Average growth';
const PURPLE = '#756bb1';
const GRAY = '#999';

const FEATURE_LABELS: Record<string, string> = {
  median_home_value: "this year's home value",
  bike_commute_rate: 'bike commute rate',
};

const GROUP_LABELS: Record<string, [string, string]> = {
  core: ['Demographics only', '6 features'],
  core_plus_autoregressive: ["+ this year's value", '7 features'],
  all: ['+ 11 more Census vars', '18 features'],
  forward_selected: ['Forward-selected', '2 features'],
};

function GroupTick({ x, y, payload }: any) {
  const [name, count] = GROUP_LABELS[payload.value] ?? [payload.value, ''];
  return (
    <g transform={`translate(${x},${y})`}>
      <text dy={16} textAnchor="middle" fontSize={13} fontWeight={600} fill="#333">{name}</text>
      <text dy={32} textAnchor="middle" fontSize={12} fill="#666">{count}</text>
    </g>
  );
}

function fmtDollar(v: number) {
  return `$${Math.round(v).toLocaleString()}`;
}

// One-sided sign test: P(at least `wins` successes in n fair coin flips).
function signTestP(wins: number, n: number) {
  const choose = (a: number, b: number) => {
    let r = 1;
    for (let i = 1; i <= b; i++) r = (r * (a - b + i)) / i;
    return r;
  };
  let p = 0;
  for (let k = wins; k <= n; k++) p += choose(n, k);
  return p / 2 ** n;
}

function H2({ children }: { children: React.ReactNode }) {
  return <h2 style={{ fontSize: '18px', fontWeight: 600, marginTop: '36px', marginBottom: '12px' }}>{children}</h2>;
}

const note = { marginBottom: '20px', fontSize: '14px', color: '#555' } as const;
const th = { padding: '6px 8px' } as const;

export default function HomeValueModelPage() {
  const [data, setData] = useState<Results | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    // no-cache: /data/* is served with a 1-hour max-age (next.config.js), so
    // without revalidation a stale copy can pair with newer page code.
    fetch('/data/home_value_prediction.json', { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setData)
      .catch(() => setError(true));
  }, []);

  const lasso = data?.model_bakeoff.find((r) => r.model === MODEL);
  const naive = data?.naive_baselines?.find((r) => r.model === NAIVE);
  const noChange = data?.naive_baselines?.find((r) => r.model === 'No change');
  const ready = data && lasso && naive && noChange && lasso.by_city && naive.by_city && lasso.folds && naive.folds;

  let foldWins = 0;
  let nFolds = 0;
  let pValue = 1;
  let modelsBeatingNaive = 0;
  let districtWins = 0;
  let improvement = 0;
  if (ready) {
    nFolds = lasso.folds!.length;
    foldWins = lasso.folds!.filter((f, i) => f.rmse < naive.folds![i].rmse).length;
    pValue = signTestP(foldWins, nFolds);
    modelsBeatingNaive = data.model_bakeoff.filter((r) => r.mean_rmse < naive.mean_rmse).length;
    districtWins = data.predictions.filter(
      (p) => Math.abs(p.preds[MODEL] - p.actual) < Math.abs(p.preds[NAIVE] - p.actual)
    ).length;
    improvement = (1 - lasso.mean_rmse / naive.mean_rmse) * 100;
  }

  const comparison = ready
    ? [
        { name: 'No change', rmse: noChange.mean_rmse, color: '#ccc' },
        { name: 'Average growth', rmse: naive.mean_rmse, color: GRAY },
        { name: 'Lasso (best of 8 models)', rmse: lasso.mean_rmse, color: PURPLE },
      ]
    : [];

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', padding: '32px 20px', lineHeight: 1.6 }}>
      <Link href="/" style={{ fontSize: '13px', color: PURPLE }}>← Back to map</Link>
      <h1 style={{ fontSize: '24px', fontWeight: 700, margin: '12px 0 20px' }}>Can Public Data Predict Home Prices?</h1>

      {error && <p style={{ color: '#c0392b' }}>Couldn&apos;t load the results.</p>}
      {!data && !error && <p style={{ color: '#888' }}>Loading…</p>}

      {ready && (
        <>
          <p style={{ marginBottom: '16px' }}>
            The question: using free public Census data, can we predict which Twin Cities districts&apos;
            home values will rise faster than others next year? The data covers{' '}
            {data.generated_from.n_districts} districts over{' '}
            {data.generated_from.panel_years[0]}–{data.generated_from.panel_years[data.generated_from.panel_years.length - 1] + 1},
            which gives {data.generated_from.n_transitions} district-year rows. Each row uses year{' '}
            <em>t</em> features to predict year <em>t+1</em> median home value. Every forecast is scored with{' '}
            <strong>leave-one-year-out cross-validation</strong>: train on 6 years, test on the 7th, and repeat
            for each year.
          </p>

          <div style={{ background: '#f6f5fb', borderLeft: `4px solid ${PURPLE}`, borderRadius: '6px', padding: '14px 16px', marginBottom: '8px' }}>
            <strong>Short answer: barely.</strong> The best model (Lasso) reaches R² {lasso.pooled_r2.toFixed(2)},
            which sounds excellent. But a forecast that ignores every district-level feature, and just assumes
            every district grows at the average rate, reaches R² {naive.pooled_r2.toFixed(2)}. Lasso&apos;s error is
            only {improvement.toFixed(0)}% lower.
          </div>

          <H2>The Headline Comparison</H2>
          <div style={{ width: '100%', height: 190, marginBottom: '8px' }}>
            <ResponsiveContainer>
              <BarChart data={comparison} layout="vertical" margin={{ left: 8, right: 24 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis type="number" tickFormatter={fmtDollar} tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 13 }} width={190} />
                <Tooltip formatter={(v: any) => [fmtDollar(Number(v)), 'Mean RMSE']} />
                <Bar dataKey="rmse" radius={[0, 4, 4, 0]}>
                  {comparison.map((c) => <Cell key={c.name} fill={c.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div style={{ overflowX: 'auto', marginBottom: '12px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #ddd', textAlign: 'right' }}>
                  <th style={{ ...th, textAlign: 'left' }}>Forecast</th>
                  <th style={th}>Mean RMSE</th>
                  <th style={th}>R²</th>
                  <th style={th}>St. Paul % error</th>
                  <th style={th}>Mpls % error</th>
                </tr>
              </thead>
              <tbody>
                {[noChange, naive, lasso].map((r) => (
                  <tr key={r.model} style={{ borderBottom: '1px solid #eee', textAlign: 'right', fontWeight: r.model === MODEL ? 700 : 400, color: r.model === MODEL ? PURPLE : '#333' }}>
                    <td style={{ ...th, textAlign: 'left' }}>{r.model}</td>
                    <td style={th}>{fmtDollar(r.mean_rmse)}</td>
                    <td style={th}>{r.pooled_r2.toFixed(3)}</td>
                    <td style={th}>{r.by_city!.stpaul.mape.toFixed(2)}%</td>
                    <td style={th}>{r.by_city!.mpls.mape.toFixed(2)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={note}>
            <strong>No change</strong> predicts next year&apos;s value equals this year&apos;s.{' '}
            <strong>Average growth</strong> applies the training years&apos; average growth rate to every district.
            Neither uses any Census feature.
          </p>

          <H2>Why the High R² Is Misleading</H2>
          <p style={{ marginBottom: '20px' }}>
            Home values are strongly autocorrelated. A district that is expensive this year will be expensive
            next year, and prices differ far more <em>between</em> districts (roughly $125K to $590K) than any
            district changes in a year (a few percent). So any forecast that starts from this year&apos;s price
            explains almost all of the variance before it learns anything about growth. Even &quot;No change&quot;
            scores R² {noChange.pooled_r2.toFixed(2)}. The meaningful test is whether a model beats Average growth,
            because that is the part that requires knowing something about each district.
          </p>

          <H2>What Lasso Does Add</H2>
          <ul style={{ marginBottom: '20px', paddingLeft: '20px' }}>
            <li style={{ marginBottom: '8px' }}>
              <strong>A small but consistent edge.</strong> Lasso beat Average growth in {foldWins} of {nFolds}{' '}
              held-out years. With only {nFolds} years, that is suggestive but not conclusive (one-sided sign test
              p ≈ {pValue.toFixed(2)}).
            </li>
            <li style={{ marginBottom: '8px' }}>
              <strong>It&apos;s not uniform.</strong> Lasso is better in Minneapolis ({lasso.by_city!.mpls.mape.toFixed(2)}% vs.{' '}
              {naive.by_city!.mpls.mape.toFixed(2)}% error) but slightly worse in St. Paul ({lasso.by_city!.stpaul.mape.toFixed(2)}% vs.{' '}
              {naive.by_city!.stpaul.mape.toFixed(2)}%). In the most recent year it was closer for {districtWins} of{' '}
              {data.predictions.length} districts.
            </li>
            <li style={{ marginBottom: '8px' }}>
              <strong>Most models do worse than the naive forecast.</strong> Of the {data.model_bakeoff.length} model
              types tested (Lasso, Ridge, Bayesian Ridge, Gaussian Process, Random Forest, Gradient Boosting, KNN,
              and SVR), only {modelsBeatingNaive} beat Average growth. The more flexible models (trees, neighbors,
              kernels) fit noise in about 170 training rows and lose to the naive forecast outright.
            </li>
          </ul>

          <H2>Which Features Matter</H2>
          <div style={{ width: '100%', height: 290, marginBottom: '8px' }}>
            <ResponsiveContainer>
              <BarChart data={data.learning_curve_features} margin={{ bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis dataKey="feature_group" tick={<GroupTick />} height={50} interval={0} />
                <YAxis tickFormatter={fmtDollar} tick={{ fontSize: 12 }} width={70} />
                <Tooltip
                  formatter={(v: any) => [fmtDollar(Number(v)), 'Lasso test RMSE']}
                  labelFormatter={(v: any) => (GROUP_LABELS[v] ? GROUP_LABELS[v].join(', ') : v)}
                />
                <Bar dataKey={MODEL} fill={PURPLE} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p style={note}>
            The chart shows Lasso&apos;s test RMSE on the {data.generated_from.test_transition} fold. Demographics
            alone (income, rent, poverty, and so on) predict price levels poorly. Adding this year&apos;s own value
            cuts error by about 75%, and adding 11 more Census variables on top makes it worse. Forward selection
            kept only 2 of {data.feature_selection.candidates.length} candidates:{' '}
            {data.feature_selection.selected.map((f) => FEATURE_LABELS[f] ?? f).join(' and ')}. In other words,
            nearly all of the predictive power comes from this year&apos;s price, which is exactly what Average
            growth already uses.
          </p>

          <H2>District Predictions ({data.generated_from.test_transition})</H2>
          <p style={note}>
            Error is (prediction − actual) / actual. Red means an overprediction and blue an underprediction. The
            ✓ marks whichever forecast was closer for each district.
          </p>
          <div style={{ overflowX: 'auto', marginBottom: '24px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #ddd', textAlign: 'right' }}>
                  <th style={{ ...th, textAlign: 'left' }}>District</th>
                  <th style={th}>Actual</th>
                  <th style={{ ...th, color: PURPLE }}>Lasso error</th>
                  <th style={{ ...th, color: '#666' }}>Avg. growth error</th>
                </tr>
              </thead>
              <tbody>
                {data.predictions
                  .slice()
                  .sort((a, b) => a.city.localeCompare(b.city) || a.district_id - b.district_id)
                  .map((p) => {
                    const errs = [MODEL, NAIVE].map((m) => ((p.preds[m] - p.actual) / p.actual) * 100);
                    const best = Math.abs(errs[0]) <= Math.abs(errs[1]) ? 0 : 1;
                    return (
                      <tr key={`${p.city}-${p.district_id}`} style={{ borderBottom: '1px solid #eee', textAlign: 'right' }}>
                        <td style={{ ...th, textAlign: 'left' }}>{p.city === 'stpaul' ? 'St. Paul' : 'Mpls'} {p.district_id}</td>
                        <td style={th}>{fmtDollar(p.actual)}</td>
                        {errs.map((e, i) => (
                          <td
                            key={i}
                            style={{
                              ...th,
                              color: e > 0 ? '#c0392b' : '#2166ac',
                              fontWeight: i === best ? 700 : 400,
                              background: i === best ? '#eafaf1' : 'transparent',
                            }}
                          >
                            {i === best && <span style={{ color: '#27ae60', marginRight: '4px' }}>✓</span>}
                            {e > 0 ? '+' : ''}{e.toFixed(1)}%
                          </td>
                        ))}
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>

          <H2>What It Would Take to Do Better</H2>
          <ul style={{ marginBottom: '20px', paddingLeft: '20px' }}>
            <li style={{ marginBottom: '6px' }}>
              <strong>Target growth directly.</strong> Predict % change instead of price level, so the evaluation
              can&apos;t lean on autocorrelation.
            </li>
            <li style={{ marginBottom: '6px' }}>
              <strong>Finer geography.</strong> Census tracts instead of districts would give roughly 10x more rows.
            </li>
            <li style={{ marginBottom: '6px' }}>
              <strong>Timelier prices.</strong> ACS 5-year estimates are rolling averages that lag the market by
              2–3 years. Zillow&apos;s monthly home value index or actual sales records would track the market directly.
            </li>
          </ul>

          <H2>Limitations</H2>
          <ul style={{ marginBottom: '24px', paddingLeft: '20px' }}>
            <li>
              The 7 folds share districts, and consecutive 5-year ACS estimates overlap. So the folds are not
              independent, and the sign test above overstates the evidence.
            </li>
            <li>
              Crime, permits, and OSM amenities are excluded because they have no matching yearly history over
              2017–2024.
            </li>
          </ul>

          <p style={{ fontSize: '13px', color: '#888' }}>
            See <Link href="/about" style={{ color: PURPLE }}>About</Link> for the Living Quality Score methodology.
          </p>
        </>
      )}
    </div>
  );
}
