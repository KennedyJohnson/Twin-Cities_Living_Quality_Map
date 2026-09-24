'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  BarChart, Bar, ScatterChart, Scatter, XAxis, YAxis, ZAxis, Tooltip, CartesianGrid,
  ResponsiveContainer, Cell, LabelList, Legend as RechartsLegend,
} from 'recharts';

interface Summary {
  model: string;
  mean_rmse: number;
  pooled_r2: number;
  by_city?: Record<string, { mape: number }>;
  folds?: { test_year: number; rmse: number }[];
}

interface ConvergenceDistrict {
  city: string;
  district_id: number;
  name: string;
  value_start: number;
  value_end: number;
  growth_pct: number;
}

interface Convergence {
  start_year: number;
  end_year: number;
  districts: ConvergenceDistrict[];
  correlations: { feature: string; r: number; p: number }[];
  quartiles: { quartile: number; mean_growth_pct: number; min_value: number; max_value: number }[];
  spread: { max_min_start: number; max_min_end: number };
  yearly: { same_sign_years: number; n_years: number; mean_r: number; single_year_excess_r2: number };
  recent_check: { window: string; r: number; p: number } | null;
}

interface Results {
  generated_from: { n_districts: number; n_transitions: number };
  convergence?: Convergence;
  model_bakeoff: Summary[];
  naive_baselines?: Summary[];
}

const PURPLE = '#756bb1';
const CITY_COLORS: Record<string, string> = { stpaul: PURPLE, mpls: '#e6550d' };
const CITY_NAMES: Record<string, string> = { stpaul: 'St. Paul', mpls: 'Minneapolis' };

function fmtDollar(v: number) {
  return `$${Math.round(v).toLocaleString()}`;
}
const fmtK = (v: number) => `$${Math.round(v / 1000)}K`;
const fmtP = (p: number) => (p < 0.001 ? 'p < 0.001' : `p = ${p.toFixed(3)}`);

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

  const c = data?.convergence;
  const lasso = data?.model_bakeoff.find((r) => r.model === 'Lasso');
  const naive = data?.naive_baselines?.find((r) => r.model === 'Average growth');
  const noChange = data?.naive_baselines?.find((r) => r.model === 'No change');

  // Label the 3 fastest- and 3 slowest-growing districts on the scatter.
  const sorted = c ? [...c.districts].sort((a, b) => a.growth_pct - b.growth_pct) : [];
  const labeled = new Set([...sorted.slice(0, 3), ...sorted.slice(-3)].map((d) => `${d.city}-${d.district_id}`));
  const points = (city: string) =>
    (c?.districts ?? [])
      .filter((d) => d.city === city)
      .map((d) => ({ ...d, label: labeled.has(`${d.city}-${d.district_id}`) ? d.name : '' }));

  const q = c?.quartiles ?? [];
  const cheapest = q[0];
  const priciest = q[q.length - 1];
  const fastest = sorted[sorted.length - 1];
  const slowest = sorted[0];
  const valueCorr = c?.correlations[0];

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', padding: '32px 20px', lineHeight: 1.6 }}>
      <Link href="/" style={{ fontSize: '13px', color: PURPLE }}>← Back to map</Link>

      {error && <p style={{ color: '#c0392b' }}>Couldn&apos;t load the results.</p>}
      {!data && !error && <p style={{ color: '#888' }}>Loading…</p>}

      {c && cheapest && priciest && valueCorr && (
        <>
          <h1 style={{ fontSize: '24px', fontWeight: 700, margin: '12px 0 20px' }}>
            The Twin Cities&apos; Neighborhood Price Gap Narrowed, {c.start_year}–{c.end_year}
          </h1>

          <div style={{ background: '#f6f5fb', borderLeft: `4px solid ${PURPLE}`, borderRadius: '6px', padding: '14px 16px', marginBottom: '16px' }}>
            Across {c.districts.length} St. Paul and Minneapolis districts, the cheapest quarter in {c.start_year}{' '}
            appreciated <strong>{cheapest.mean_growth_pct.toFixed(0)}%</strong> by {c.end_year}, and the most expensive
            quarter appreciated <strong>{priciest.mean_growth_pct.toFixed(0)}%</strong>. The priciest district was worth{' '}
            {c.spread.max_min_start.toFixed(1)}× the cheapest in {c.start_year}, and {c.spread.max_min_end.toFixed(1)}× in{' '}
            {c.end_year}. Lower-cost, more diverse neighborhoods with fewer college graduates saw the biggest gains.
          </div>

          <H2>Starting Price vs. Growth</H2>
          <div style={{ width: '100%', height: 380, marginBottom: '8px' }}>
            <ResponsiveContainer>
              <ScatterChart margin={{ top: 12, right: 24, bottom: 24, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis
                  type="number" dataKey="value_start" name={`${c.start_year} value`} tickFormatter={fmtK}
                  tick={{ fontSize: 12 }} domain={['dataMin - 20000', 'dataMax + 20000']}
                  label={{ value: `Median home value, ${c.start_year}`, position: 'insideBottom', offset: -14, fontSize: 12 }}
                />
                <YAxis
                  type="number" dataKey="growth_pct" name="Growth" tickFormatter={(v) => `${v}%`} tick={{ fontSize: 12 }}
                  width={50} domain={[30, 100]} ticks={[30, 50, 70, 90]}
                  label={{ value: `Growth to ${c.end_year}`, angle: -90, position: 'insideLeft', fontSize: 12 }}
                />
                <ZAxis range={[70, 70]} />
                <Tooltip
                  cursor={{ strokeDasharray: '3 3' }}
                  content={({ payload }: any) => {
                    const d = payload?.[0]?.payload as ConvergenceDistrict | undefined;
                    if (!d) return null;
                    return (
                      <div style={{ background: '#fff', border: '1px solid #ddd', padding: '8px 10px', fontSize: '13px' }}>
                        <strong>{d.name}</strong> ({CITY_NAMES[d.city]})
                        <div>{fmtDollar(d.value_start)} → {fmtDollar(d.value_end)}</div>
                        <div>+{d.growth_pct.toFixed(1)}%</div>
                      </div>
                    );
                  }}
                />
                <RechartsLegend verticalAlign="top" />
                {['stpaul', 'mpls'].map((city) => (
                  <Scatter key={city} name={CITY_NAMES[city]} data={points(city)} fill={CITY_COLORS[city]}>
                    <LabelList dataKey="label" position="right" style={{ fontSize: 11, fill: '#444' }} />
                  </Scatter>
                ))}
              </ScatterChart>
            </ResponsiveContainer>
          </div>
          <p style={note}>
            Each dot is a district. {fastest.name} grew fastest (+{fastest.growth_pct.toFixed(0)}%, from{' '}
            {fmtDollar(fastest.value_start)}) and {slowest.name} slowest (+{slowest.growth_pct.toFixed(0)}%). The
            correlation between starting price and growth is r = {valueCorr.r.toFixed(2)} ({fmtP(valueCorr.p)}).
          </p>

          <div style={{ width: '100%', height: 220, marginBottom: '8px' }}>
            <ResponsiveContainer>
              <BarChart data={q} margin={{ top: 20, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis
                  dataKey="quartile" height={44} interval={0}
                  tick={({ x, y, payload }: any) => {
                    const row = q[payload.index];
                    return (
                      <g transform={`translate(${x},${y})`}>
                        <text dy={16} textAnchor="middle" fontSize={13} fontWeight={600} fill="#333">
                          {['Cheapest', '2nd', '3rd', 'Priciest'][payload.index]} quarter
                        </text>
                        <text dy={32} textAnchor="middle" fontSize={11} fill="#666">
                          {fmtK(row.min_value)}–{fmtK(row.max_value)}
                        </text>
                      </g>
                    );
                  }}
                />
                <YAxis tickFormatter={(v) => `${v}%`} tick={{ fontSize: 12 }} width={50} />
                <Tooltip formatter={(v: any) => [`+${Number(v).toFixed(1)}%`, `Avg. growth ${c.start_year}–${c.end_year}`]} labelFormatter={() => ''} />
                <Bar dataKey="mean_growth_pct" radius={[4, 4, 0, 0]}>
                  {q.map((row, i) => <Cell key={row.quartile} fill={i === 0 ? PURPLE : i === q.length - 1 ? '#bbb' : '#b6aed6'} />)}
                  <LabelList dataKey="mean_growth_pct" position="top" formatter={(v: any) => `+${Number(v).toFixed(0)}%`} style={{ fontSize: 12 }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p style={note}>
            This is average growth by {c.start_year} price quarter (7 districts each). The two middle quarters are
            about even. The gap is between the cheapest and the priciest.
          </p>

          <H2>What Predicted Faster Growth</H2>
          <ul style={{ marginBottom: '16px', paddingLeft: '20px' }}>
            {c.correlations.map((r) => (
              <li key={r.feature}>
                <strong>{r.feature}</strong>: r = {r.r.toFixed(2)} ({fmtP(r.p)})
              </li>
            ))}
          </ul>
          <p style={note}>
            These are correlations with {c.start_year}–{c.end_year} growth across {c.districts.length} districts. They
            overlap: the cheaper districts also tended to be more diverse and to have fewer college graduates. So this
            describes which neighborhoods gained, not why. Rising prices in formerly affordable neighborhoods are also
            a signal of affordability loss and potential displacement pressure for existing residents.
          </p>

          <H2>Invisible Year to Year, Large Over Time</H2>
          <p style={{ marginBottom: '20px' }}>
            In any single year, the effect is small and noisy. A model trying to predict which districts would beat
            that year&apos;s citywide average did worse than simply predicting the average (out-of-sample R²{' '}
            {c.yearly.single_year_excess_r2.toFixed(2)}). But the direction was the same in {c.yearly.same_sign_years}{' '}
            of {c.yearly.n_years} years: cheaper districts slightly outgrew pricier ones (average yearly r ={' '}
            {c.yearly.mean_r.toFixed(2)}). Compounded over {c.end_year - c.start_year} years, those small edges added up to
            a {(cheapest.mean_growth_pct - priciest.mean_growth_pct).toFixed(0)}-point gap. Evaluating a model one year
            at a time would have missed the trend completely.
          </p>

          {c.recent_check && (
            <>
              <H2>Has It Continued?</H2>
              <p style={{ marginBottom: '20px' }}>
                Apparently not. Over the most recent window, {c.recent_check.window.replace('-', '–')}, growth shows no
                relationship with {c.start_year} price (r = {c.recent_check.r.toFixed(2)}, {fmtP(c.recent_check.p)}). The
                catch-up was concentrated earlier in the period, which included the 2020–2022 pandemic-era housing boom.
              </p>
            </>
          )}

          <H2>Caveats</H2>
          <ul style={{ marginBottom: '20px', paddingLeft: '20px' }}>
            <li style={{ marginBottom: '6px' }}>
              <strong>Regression to the mean.</strong> If a district&apos;s {c.start_year} Census estimate came in low by
              chance, it will look like it grew more. Two things limit this: each district averages many tracts, and{' '}
              {c.start_year} bachelor&apos;s-degree share predicts growth as strongly as starting price does, even though it
              plays no part in the growth calculation.
            </li>
            <li style={{ marginBottom: '6px' }}>
              <strong>Smoothed data.</strong> ACS 5-year estimates are rolling averages, so &quot;{c.start_year}&quot; covers{' '}
              {c.start_year - 4}–{c.start_year} and &quot;{c.end_year}&quot; covers {c.end_year - 4}–{c.end_year}. Timing is
              blurred by a few years.
            </li>
            <li>
              <strong>Correlation, not cause.</strong> With {c.districts.length} districts, this can&apos;t separate price level,
              education, and demographics from each other.
            </li>
          </ul>

          {lasso && naive && noChange && (
            <>
              <H2>Can a Model Forecast Next Year&apos;s Price?</H2>
              <p style={{ marginBottom: '12px' }}>
                The same data was used to forecast each district&apos;s next-year median home value. It was scored with
                leave-one-year-out cross-validation across {data!.generated_from.n_transitions} district-years, testing 8
                model types.
              </p>
              <div style={{ overflowX: 'auto', marginBottom: '12px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #ddd', textAlign: 'right' }}>
                      <th style={{ ...th, textAlign: 'left' }}>Forecast</th>
                      <th style={th}>Mean RMSE</th>
                      <th style={th}>R²</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ['No change (next year = this year)', noChange],
                      ['Average growth (every district grows at the mean rate)', naive],
                      ['Lasso (best of 8 models)', lasso],
                    ].map(([label, r]: any) => (
                      <tr key={label} style={{ borderBottom: '1px solid #eee', textAlign: 'right', fontWeight: r === lasso ? 700 : 400, color: r === lasso ? PURPLE : '#333' }}>
                        <td style={{ ...th, textAlign: 'left' }}>{label}</td>
                        <td style={th}>{fmtDollar(r.mean_rmse)}</td>
                        <td style={th}>{r.pooled_r2.toFixed(3)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p style={note}>
                Lasso&apos;s R² of {lasso.pooled_r2.toFixed(2)} looks impressive, but the feature-free Average growth
                forecast matches it, and Lasso&apos;s error is only{' '}
                {((1 - lasso.mean_rmse / naive.mean_rmse) * 100).toFixed(0)}% lower. Almost all of the accuracy comes from
                knowing this year&apos;s price, because home values are strongly autocorrelated. That is the same reason
                the long-run convergence above is invisible to a year-ahead forecast.
              </p>
            </>
          )}

          <p style={{ fontSize: '13px', color: '#888' }}>
            Color the <Link href="/" style={{ color: PURPLE }}>map</Link> by &quot;Home Value Growth since{' '}
            {c.start_year}&quot; to see this geographically. See <Link href="/about" style={{ color: PURPLE }}>How Scores Work</Link>{' '}
            for the Living Quality Score methodology.
          </p>
        </>
      )}
    </div>
  );
}
