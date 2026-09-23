'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer,
} from 'recharts';

type ModelPoint = Record<string, number | string>;

interface Results {
  generated_from: { panel_years: number[]; n_districts: number; n_transitions: number; test_transition: string };
  feature_selection: { candidates: string[]; selected: string[] };
  model_bakeoff: {
    model: string; mean_rmse: number; std_rmse: number; pooled_r2: number;
    by_city?: Record<string, { rmse: number; mape: number; n: number }>;
  }[];
  predictions: { city: string; district_id: number; actual: number; preds: Record<string, number> }[];
  naive_baselines?: { model: string; mean_rmse: number; std_rmse: number; pooled_r2: number;
    by_city: Record<string, { rmse: number; mape: number; n: number }> }[];
  learning_curve_years: ModelPoint[];
  learning_curve_features: ModelPoint[];
}

const MODEL = 'Lasso';
const NAIVE = 'Average growth';
const PURPLE = '#756bb1';

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

  const lasso = data?.model_bakeoff.find((r) => r.model === MODEL);

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', padding: '32px 20px', lineHeight: 1.6 }}>
      <Link href="/" style={{ fontSize: '13px', color: PURPLE }}>← Back to map</Link>
      <h1 style={{ fontSize: '24px', fontWeight: 700, margin: '12px 0 20px' }}>Home Price Prediction</h1>

      {error && <p style={{ color: '#c0392b' }}>Couldn&apos;t load the model results.</p>}
      {!data && !error && <p style={{ color: '#888' }}>Loading…</p>}

      {data && lasso && (
        <>
          <p style={{ marginBottom: '20px' }}>
            Each row is one district in one year: Census ACS features in year <em>t</em> predict that
            district&apos;s median home value in year <em>t+1</em>. There are{' '}
            {data.generated_from.n_districts} districts and{' '}
            {data.generated_from.panel_years[0]}–{data.generated_from.panel_years[data.generated_from.panel_years.length - 1] + 1}{' '}
            data, which gives {data.generated_from.n_transitions} rows. The model is scored with{' '}
            <strong>leave-one-year-out cross-validation</strong>: train on 6 years, test on the 7th, and repeat for
            each year. That gives 7 held-out results instead of one test split.
          </p>

          <H2>The Model: Lasso Regression</H2>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '16px' }}>
            {[
              ['Mean error (RMSE)', `${fmtDollar(lasso.mean_rmse)} ± ${fmtDollar(lasso.std_rmse)}`],
              ['R²', lasso.pooled_r2.toFixed(3)],
              ...(lasso.by_city
                ? [
                    ['St. Paul avg. % error', `${lasso.by_city.stpaul.mape.toFixed(1)}%`],
                    ['Minneapolis avg. % error', `${lasso.by_city.mpls.mape.toFixed(1)}%`],
                  ]
                : []),
            ].map(([label, value]) => (
              <div key={label} style={{ flex: '1 1 160px', background: '#f6f5fb', borderRadius: '8px', padding: '12px 14px' }}>
                <div style={{ fontSize: '12px', color: '#666' }}>{label}</div>
                <div style={{ fontSize: '20px', fontWeight: 700, color: PURPLE }}>{value}</div>
              </div>
            ))}
          </div>
          <p style={{ marginBottom: '16px' }}>
            Lasso came out ahead of the {data.model_bakeoff.length - 1} other model types tested:
            Ridge, Bayesian Ridge, Gaussian Process, Random Forest, Gradient Boosting, K-Nearest Neighbors,
            and Support Vector Regression. It had the lowest average error across all 7 held-out years.
          </p>
          <p style={{ marginBottom: '20px' }}>
            Two properties explain why. With only about 170 training rows, accuracy is limited by{' '}
            <strong>variance, not bias</strong>. Lasso&apos;s L1 penalty controls variance by shrinking
            correlated coefficients and zeroing out weak ones. The relationship being learned is also close
            to linear, since next year&apos;s value is roughly this year&apos;s value times a growth rate.
            Tree ensembles and nearest-neighbor methods fit that relationship from local splits, each of
            which sees only a fraction of the rows, so they pay a variance cost for flexibility the data
            doesn&apos;t need.
          </p>

          {data.naive_baselines && lasso.by_city && (
            <>
              <H2>Compared to Naive Forecasts</H2>
              <p style={note}>
                Two forecasts that use no features, scored the same way: <strong>No change</strong> (next
                year&apos;s value = this year&apos;s) and <strong>Average growth</strong> (every district grows at
                the training years&apos; average rate).
              </p>
              <div style={{ overflowX: 'auto', marginBottom: '12px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #ddd', textAlign: 'right' }}>
                      <th style={{ textAlign: 'left', padding: '6px 8px' }}>Forecast</th>
                      <th style={{ padding: '6px 8px' }}>Mean RMSE</th>
                      <th style={{ padding: '6px 8px' }}>R²</th>
                      <th style={{ padding: '6px 8px' }}>St. Paul % error</th>
                      <th style={{ padding: '6px 8px' }}>Mpls % error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...data.naive_baselines, lasso].map((r) => (
                      <tr
                        key={r.model}
                        style={{
                          borderBottom: '1px solid #eee', textAlign: 'right',
                          fontWeight: r.model === MODEL ? 700 : 400,
                          color: r.model === MODEL ? PURPLE : '#333',
                        }}
                      >
                        <td style={{ textAlign: 'left', padding: '6px 8px' }}>{r.model}</td>
                        <td style={{ padding: '6px 8px' }}>{fmtDollar(r.mean_rmse)}</td>
                        <td style={{ padding: '6px 8px' }}>{r.pooled_r2.toFixed(3)}</td>
                        <td style={{ padding: '6px 8px' }}>{r.by_city!.stpaul.mape.toFixed(2)}%</td>
                        <td style={{ padding: '6px 8px' }}>{r.by_city!.mpls.mape.toFixed(2)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p style={note}>
                Lasso cuts error by about 40% against No change, but most of that gain comes from learning the
                citywide growth rate, which Average growth also captures. Against Average growth, Lasso is only
                about 3% better overall, and slightly worse in St. Paul. So the model is good at forecasting
                price levels, but it adds little skill at telling <em>which</em> districts will grow faster than
                the average.
              </p>
            </>
          )}

          <H2>Feature Selection</H2>
          <div style={{ width: '100%', height: 290, marginBottom: '8px' }}>
            <ResponsiveContainer>
              <BarChart data={data.learning_curve_features} margin={{ bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis dataKey="feature_group" tick={<GroupTick />} height={50} interval={0} />
                <YAxis tickFormatter={fmtDollar} tick={{ fontSize: 12 }} width={70} />
                <Tooltip formatter={(v: any) => [fmtDollar(Number(v)), 'Test RMSE']} labelFormatter={(v: any) => groupLabel(v)} />
                <Bar dataKey={MODEL} fill={PURPLE} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p style={note}>
            The chart shows test RMSE on the {data.generated_from.test_transition} fold. Features were
            chosen by greedy forward selection on cross-validated error. Only 2 of{' '}
            {data.feature_selection.candidates.length} candidates survived:{' '}
            {data.feature_selection.selected.map((f) => FEATURE_LABELS[f] ?? f).join(' and ')}. Adding this
            year&apos;s own home value to the 6 demographic features cuts error by about 75%, because home values
            are strongly autocorrelated. Adding 11 more Census variables on top makes it <em>worse</em>: with
            this little data, each extra column adds more variance than signal.
          </p>

          <H2>More Years of Training Data</H2>
          <div style={{ width: '100%', height: 260, marginBottom: '8px' }}>
            <ResponsiveContainer>
              <LineChart data={data.learning_curve_years} margin={{ bottom: 12 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis dataKey="n_training_years" tick={{ fontSize: 12 }} label={{ value: 'Most recent N training years', position: 'insideBottom', offset: -8, fontSize: 12 }} />
                <YAxis tickFormatter={fmtDollar} tick={{ fontSize: 12 }} width={70} />
                <Tooltip formatter={(v: any) => [fmtDollar(Number(v)), 'Test RMSE']} />
                <Line type="monotone" dataKey={MODEL} stroke={PURPLE} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p style={note}>
            As older years are added back to the training data, error falls from about $15K with 2 years to
            $10K with 6. With a stable autoregressive signal, more history refines the same relationship
            instead of confusing it.
          </p>

          <H2>District Predictions ({data.generated_from.test_transition})</H2>
          <p style={note}>
            Error is (prediction − actual) / actual. Red means an overprediction and blue an underprediction.
            The gray column is the Average growth forecast, for reference.
          </p>
          <div style={{ overflowX: 'auto', marginBottom: '24px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #ddd', textAlign: 'right' }}>
                  <th style={{ textAlign: 'left', padding: '6px 8px' }}>District</th>
                  <th style={{ padding: '6px 8px' }}>Actual</th>
                  <th style={{ padding: '6px 8px' }}>Predicted</th>
                  <th style={{ padding: '6px 8px' }}>Lasso error</th>
                  <th style={{ padding: '6px 8px', color: '#888' }}>Avg. growth error</th>
                </tr>
              </thead>
              <tbody>
                {data.predictions
                  .slice()
                  .sort((a, b) => a.city.localeCompare(b.city) || a.district_id - b.district_id)
                  .map((p) => {
                    const pred = p.preds[MODEL];
                    const e = ((pred - p.actual) / p.actual) * 100;
                    const naive = p.preds[NAIVE];
                    const ne = naive != null ? ((naive - p.actual) / p.actual) * 100 : null;
                    return (
                      <tr key={`${p.city}-${p.district_id}`} style={{ borderBottom: '1px solid #eee', textAlign: 'right' }}>
                        <td style={{ textAlign: 'left', padding: '6px 8px' }}>
                          {p.city === 'stpaul' ? 'St. Paul' : 'Mpls'} {p.district_id}
                        </td>
                        <td style={{ padding: '6px 8px' }}>{fmtDollar(p.actual)}</td>
                        <td style={{ padding: '6px 8px' }}>{fmtDollar(pred)}</td>
                        <td style={{ padding: '6px 8px', color: e > 0 ? '#c0392b' : '#2166ac' }}>
                          {e > 0 ? '+' : ''}{e.toFixed(1)}%
                        </td>
                        <td style={{ padding: '6px 8px', color: '#888' }}>
                          {ne == null ? '–' : `${ne > 0 ? '+' : ''}${ne.toFixed(1)}%`}
                        </td>
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
              The model predicts price <em>levels</em> well mainly because it knows this year&apos;s price. It is
              much weaker at ranking which districts will appreciate fastest.
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
