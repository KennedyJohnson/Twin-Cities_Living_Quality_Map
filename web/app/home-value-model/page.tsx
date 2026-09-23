'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
  Legend as RechartsLegend, ResponsiveContainer, Cell,
} from 'recharts';

type ModelPoint = Record<string, number | string>;

interface Results {
  generated_from: { panel_years: number[]; n_districts: number; n_transitions: number; test_transition: string };
  feature_selection: { candidates: string[]; selected: string[] };
  top_models: string[];
  featured_models: string[];
  model_bakeoff: {
    model: string; mean_rmse: number; std_rmse: number; pooled_r2: number;
    by_city: Record<string, { rmse: number; mape: number; n: number }>;
  }[];
  test_metrics: Record<string, { rmse: number; r2: number }>;
  predictions: { city: string; district_id: number; actual: number; preds: Record<string, number> }[];
  learning_curve_years: ModelPoint[];
  learning_curve_features: ModelPoint[];
}

const PURPLE = '#756bb1';
const MODEL_COLORS: Record<string, string> = {
  Lasso: '#756bb1',
  'Bayesian Ridge': '#2ca25f',
  'Gaussian Process': '#3182bd',
  'Gradient Boosting': '#e6550d',
};
const colorFor = (m: string) => MODEL_COLORS[m] ?? '#999';

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
const groupLabel = (v: string) => (GROUP_LABELS[v] ? GROUP_LABELS[v].join(', ') : v);

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

function H2({ children }: { children: React.ReactNode }) {
  return <h2 style={{ fontSize: '18px', fontWeight: 600, marginTop: '36px', marginBottom: '12px' }}>{children}</h2>;
}

const note = { marginBottom: '20px', fontSize: '14px', color: '#555' } as const;

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

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', padding: '32px 20px', lineHeight: 1.6 }}>
      <Link href="/" style={{ fontSize: '13px', color: PURPLE }}>← Back to map</Link>
      <h1 style={{ fontSize: '24px', fontWeight: 700, margin: '12px 0 8px' }}>Predicting Next-Year Home Value</h1>
      <p style={{ fontSize: '13px', color: '#666', marginBottom: '20px' }}>
        Code and data:{' '}
        <code style={{ background: '#f4f4f4', padding: '1px 5px', borderRadius: '3px' }}>
          pipeline/analysis/home_value_prediction/
        </code>
      </p>

      {error && <p style={{ color: '#c0392b' }}>Couldn&apos;t load the model results.</p>}
      {!data && !error && <p style={{ color: '#888' }}>Loading…</p>}

      {data && (
        <>
          <p style={{ marginBottom: '20px' }}>
            Each row is one district in one year: Census ACS features in year <em>t</em> predict
            that district&apos;s median home value in year <em>t+1</em>. There are{' '}
            {data.generated_from.n_districts} districts and{' '}
            {data.generated_from.panel_years[0]}–{data.generated_from.panel_years[data.generated_from.panel_years.length - 1] + 1}{' '}
            data, which gives {data.generated_from.n_transitions} rows. Every model is scored with{' '}
            <strong>leave-one-year-out cross-validation</strong>: train on 6 years, test on the 7th, and
            repeat for each year. That gives 7 held-out results per model instead of one test split.
            Features were chosen by greedy forward selection on cross-validated error. Only 2 of{' '}
            {data.feature_selection.candidates.length} candidates survived:{' '}
            {data.feature_selection.selected.map((f) => FEATURE_LABELS[f] ?? f).join(' and ')}.
          </p>

          <H2>Model Ranking</H2>
          <div style={{ width: '100%', height: 260, marginBottom: '8px' }}>
            <ResponsiveContainer>
              <BarChart data={data.model_bakeoff} layout="vertical" margin={{ left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis type="number" tickFormatter={fmtDollar} tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="model" tick={{ fontSize: 12 }} width={140} />
                <Tooltip
                  formatter={(v: any, _n: any, item: any) => [
                    `${fmtDollar(Number(v))} ± ${fmtDollar(item.payload.std_rmse)} (R² ${item.payload.pooled_r2})`,
                    'Mean RMSE',
                  ]}
                />
                <Bar dataKey="mean_rmse" radius={[0, 4, 4, 0]}>
                  {data.model_bakeoff.map((m) => (
                    <Cell key={m.model} fill={data.top_models.includes(m.model) ? colorFor(m.model) : '#ccc'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p style={note}>
            This is mean RMSE across the 7 year-folds, lower is better, with the top 3 in color. The top 3
            are within ~$300 of each other. The next gap is $1–7K, down to the tree, kernel, and neighbor
            models. Elastic Net was also tested, but cross-validation picked a pure-L1 penalty on every
            fold, which made it identical to Lasso, so it&apos;s omitted.
          </p>

          {data.model_bakeoff.every((r) => r.by_city) && (<>
          <H2>Accuracy by City</H2>
          <p style={note}>
            Mean absolute % error for each city, pooled over all 7 held-out years (lower is better). The ✓
            marks the best model per city.
          </p>
          <div style={{ overflowX: 'auto', marginBottom: '12px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #ddd', textAlign: 'right' }}>
                  <th style={{ textAlign: 'left', padding: '6px 8px' }}>City</th>
                  {data.top_models.map((m) => (
                    <th key={m} style={{ padding: '6px 8px', color: colorFor(m) }}>{m}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[['stpaul', 'St. Paul'], ['mpls', 'Minneapolis']].map(([city, label]) => {
                  const rows = data.top_models.map((m) => data.model_bakeoff.find((r) => r.model === m)!.by_city[city]);
                  const best = rows.reduce((bi, r, i) => (r.mape < rows[bi].mape ? i : bi), 0);
                  return (
                    <tr key={city} style={{ borderBottom: '1px solid #eee', textAlign: 'right' }}>
                      <td style={{ textAlign: 'left', padding: '6px 8px' }}>
                        {label} <span style={{ color: '#888', fontSize: '12px' }}>({rows[0].n} predictions)</span>
                      </td>
                      {rows.map((r, i) => (
                        <td
                          key={i}
                          style={{
                            padding: '6px 8px',
                            fontWeight: i === best ? 700 : 400,
                            background: i === best ? '#eafaf1' : 'transparent',
                          }}
                        >
                          {i === best && <span style={{ color: '#27ae60', marginRight: '4px' }}>✓</span>}
                          {r.mape.toFixed(2)}%
                          <div style={{ fontSize: '11px', color: '#888', fontWeight: 400 }}>RMSE {fmtDollar(r.rmse)}</div>
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p style={note}>
            The top 3 are close in both cities. The margins are hundredths to tenths of a percentage point,
            well inside fold-to-fold noise, so neither city has a clear winner. All three are more accurate
            in percentage terms in Minneapolis, even though their dollar errors there are higher, because
            Minneapolis home values are higher.
          </p>
          </>)}

          <H2>Why the Small-Sample Models Win</H2>
          <p style={{ marginBottom: '12px' }}>
            With about 170 training rows, the limiting factor is <strong>variance, not bias</strong>. The top 3
            each control variance in a different way:
          </p>
          <ul style={{ marginBottom: '16px', paddingLeft: '20px' }}>
            <li><strong>Lasso</strong> uses an L1 penalty tuned by CV. It shrinks correlated coefficients and zeroes out weak ones.</li>
            <li><strong>Bayesian Ridge</strong> uses an L2 penalty whose strength is estimated from the data by maximizing the marginal likelihood, rather than tuned by CV.</li>
            <li><strong>Gaussian Process</strong> uses a smooth kernel prior plus an explicit noise term, so it doesn&apos;t fit the noise.</li>
          </ul>
          <p style={{ marginBottom: '20px' }}>
            The relationship being learned is almost linear, because next year&apos;s value is roughly this
            year&apos;s value times a growth rate. Gradient Boosting, Random Forest, and KNN estimate that
            relationship from local splits or neighborhoods. Each split sees only a fraction of the rows,
            so they pay a variance cost for flexibility the data doesn&apos;t need. With many more
            district-years, the ranking could change.
          </p>

          <H2>More Features vs. More Years</H2>
          <div style={{ width: '100%', height: 290, marginBottom: '8px' }}>
            <ResponsiveContainer>
              <BarChart data={data.learning_curve_features} margin={{ bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis dataKey="feature_group" tick={<GroupTick />} height={50} interval={0} />
                <YAxis tickFormatter={fmtDollar} tick={{ fontSize: 12 }} width={70} />
                <Tooltip formatter={(v: any) => fmtDollar(Number(v))} labelFormatter={(v: any) => groupLabel(v)} />
                <RechartsLegend />
                {data.top_models.map((m) => (
                  <Bar key={m} dataKey={m} name={m} fill={colorFor(m)} radius={[3, 3, 0, 0]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p style={note}>
            The chart shows test RMSE on the {data.generated_from.test_transition} fold. Adding this year&apos;s
            own home value to the 6 demographic features cuts error by about 75%, from roughly $47K to $11K,
            because home values are strongly autocorrelated. Adding 11 more ACS variables on top of that
            makes all three <em>worse</em>: with this little data, each extra column adds more
            variance than signal. The 2-feature selected set is best for all three.
          </p>

          <div style={{ width: '100%', height: 260, marginBottom: '8px' }}>
            <ResponsiveContainer>
              <LineChart data={data.learning_curve_years} margin={{ bottom: 12 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis dataKey="n_training_years" tick={{ fontSize: 12 }} label={{ value: 'Most recent N training years', position: 'insideBottom', offset: -8, fontSize: 12 }} />
                <YAxis tickFormatter={fmtDollar} tick={{ fontSize: 12 }} width={70} />
                <Tooltip formatter={(v: any) => fmtDollar(Number(v))} />
                <RechartsLegend verticalAlign="top" />
                {data.top_models.map((m) => (
                  <Line
                    key={m}
                    type="monotone"
                    dataKey={m}
                    name={m}
                    stroke={colorFor(m)}
                    strokeWidth={2}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p style={note}>
            When older years are added back to the training data, all three improve from about $15K at 2
            years to $10K at 6. With a stable autoregressive signal, more years of history refine the same
            relationship instead of confusing it. Lasso and Bayesian Ridge are nearly identical here, so
            their lines overlap.
          </p>

          <H2>District Predictions ({data.generated_from.test_transition})</H2>
          <p style={note}>
            Error is (prediction − actual) / actual. Red means an overprediction and blue an
            underprediction. The ✓ marks the model that was closest for each district.
          </p>
          <div style={{ overflowX: 'auto', marginBottom: '24px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #ddd', textAlign: 'right' }}>
                  <th style={{ textAlign: 'left', padding: '6px 8px' }}>District</th>
                  <th style={{ padding: '6px 8px' }}>Actual</th>
                  {data.top_models.map((m) => (
                    <th key={m} style={{ padding: '6px 8px', color: colorFor(m) }}>{m}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.predictions
                  .slice()
                  .sort((a, b) => a.city.localeCompare(b.city) || a.district_id - b.district_id)
                  .map((p) => {
                    const errs = data.top_models.map((m) => ((p.preds[m] - p.actual) / p.actual) * 100);
                    const best = errs.reduce((bi, e, i) => (Math.abs(e) < Math.abs(errs[bi]) ? i : bi), 0);
                    return (
                      <tr key={`${p.city}-${p.district_id}`} style={{ borderBottom: '1px solid #eee', textAlign: 'right' }}>
                        <td style={{ textAlign: 'left', padding: '6px 8px' }}>
                          {p.city === 'stpaul' ? 'St. Paul' : 'Mpls'} {p.district_id}
                        </td>
                        <td style={{ padding: '6px 8px' }}>{fmtDollar(p.actual)}</td>
                        {errs.map((e, i) => (
                          <td
                            key={i}
                            style={{
                              padding: '6px 8px',
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

          <H2>Limitations</H2>
          <ul style={{ marginBottom: '24px', paddingLeft: '20px' }}>
            <li>
              The 7 folds share districts, and consecutive 5-year ACS estimates overlap. So the folds are not
              independent samples, and the ± spread understates the true uncertainty.
            </li>
            <li>
              Crime, permits, and OSM amenities are excluded because they have no matching yearly history
              over 2017–2024.
            </li>
          </ul>

          <p style={{ fontSize: '13px', color: '#888' }}>
            See <Link href="/about" style={{ color: PURPLE }}>About</Link> for the Living Quality Score
            methodology.
          </p>
        </>
      )}
    </div>
  );
}
