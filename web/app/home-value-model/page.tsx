'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
  Legend as RechartsLegend, ResponsiveContainer, Cell,
} from 'recharts';

interface Results {
  generated_from: {
    panel_years: number[];
    n_districts: number;
    train_rows: number;
    test_rows: number;
    test_transition: string;
  };
  feature_selection: {
    candidates: string[];
    selected: string[];
    history: { step: number; added: string | null; features: string[]; cv_rmse: number }[];
  };
  test_metrics: {
    lasso: { rmse: number; mae: number; r2: number };
    gbm: { rmse: number; mae: number; r2: number };
  };
  lasso_coefficients: Record<string, number>;
  gbm_feature_importances: Record<string, number>;
  predictions: {
    city: string; district_id: number; actual: number; lasso_pred: number;
    gbm_pred: number; appreciation_pct: number;
  }[];
  learning_curve_years: { n_training_years: number; training_rows: number; lasso_rmse: number | null; gbm_rmse: number }[];
  learning_curve_features: { feature_group: string; n_features: number; lasso_rmse: number; gbm_rmse: number }[];
}

const PURPLE = '#756bb1';
const ORANGE = '#e6550d';
const FEATURE_LABELS: Record<string, string> = {
  median_household_income: 'Household income', homeownership_rate: 'Homeownership rate',
  gini_index: 'Income inequality (Gini)', diversity_index: 'Diversity index',
  bachelors_rate: "Bachelor's+ rate", median_age: 'Median age', vacancy_rate: 'Vacancy rate',
  broadband_rate: 'Broadband rate', avg_commute_min: 'Avg. commute (min)',
  bike_commute_rate: 'Bike commute rate', wfh_rate: 'Work-from-home rate',
  median_gross_rent: 'Gross rent', poverty_rate: 'Poverty rate',
  housing_cost_burden_rate: 'Housing cost burden', unemployment_rate_pc: 'Unemployment rate',
  transit_commute_rate: 'Transit commute rate', walk_commute_rate: 'Walk commute rate',
};

function fmtDollar(v: number) {
  return `$${Math.round(v).toLocaleString()}`;
}

function h2(text: string) {
  return (
    <h2 style={{ fontSize: '18px', fontWeight: 600, marginTop: '36px', marginBottom: '12px' }}>
      {text}
    </h2>
  );
}

export default function HomeValueModelPage() {
  const [data, setData] = useState<Results | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch('/data/home_value_prediction.json')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setData)
      .catch(() => setError(true));
  }, []);

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', padding: '32px 20px', lineHeight: 1.6 }}>
      <Link href="/" style={{ fontSize: '13px', color: PURPLE }}>
        ← Back to map
      </Link>
      <h1 style={{ fontSize: '24px', fontWeight: 700, margin: '12px 0 8px' }}>
        Predicting Home Value: Lasso vs. Gradient Boosting
      </h1>
      <p style={{ fontSize: '13px', color: '#666', marginBottom: '20px' }}>
        A model-comparison analysis built on top of the map&apos;s Census pipeline. Code and data:{' '}
        <code style={{ background: '#f4f4f4', padding: '1px 5px', borderRadius: '3px' }}>
          pipeline/analysis/home_value_prediction/
        </code>
      </p>

      <p style={{ marginBottom: '20px' }}>
        The map itself scores districts on a single blended Living Quality Score. This page asks a
        narrower, more predictive question: given a district&apos;s features in one year, how well
        can a model predict its <strong>median home value the following year</strong>, and does a
        more flexible model (gradient-boosted trees) actually beat a simple regularized linear one
        (Lasso) here, given how little data 28 districts and a handful of years really is?
      </p>

      {error && <p style={{ color: '#c0392b' }}>Couldn&apos;t load the model results.</p>}
      {!data && !error && <p style={{ color: '#888' }}>Loading…</p>}

      {data && (
        <>
          {h2('The Data')}
          <p style={{ marginBottom: '20px' }}>
            The site&apos;s own affordability trend charts only cover 2018–2022 (5 years), which is
            enough for a line chart, not enough to train a model. This analysis instead pulls the
            same Census ACS loader across {data.generated_from.panel_years[0]}–
            {data.generated_from.panel_years[data.generated_from.panel_years.length - 1]} (
            {data.generated_from.panel_years.length} years), across all {data.generated_from.n_districts}{' '}
            districts in both cities: {data.generated_from.train_rows} training district-year
            transitions plus a held-out test transition ({data.generated_from.test_transition}) that
            was never touched during feature selection or model tuning. Each row predicts next-year
            median home value from this year&apos;s features, a genuine forward-in-time
            prediction, not a same-year correlation.
          </p>

          {h2('Feature Selection')}
          <p style={{ marginBottom: '20px' }}>
            Rather than throw every available Census variable at the model, features were added one
            at a time, greedily, starting from a mean-only baseline, keeping whichever addition
            most improved leave-one-year-out cross-validated error on the training years, and
            stopping once nothing left improved it. {data.feature_selection.selected.length} of{' '}
            {data.feature_selection.candidates.length} candidate variables survived:
          </p>
          <ul style={{ marginBottom: '20px', paddingLeft: '20px', columns: 2 }}>
            {data.feature_selection.selected.map((f) => (
              <li key={f}>{FEATURE_LABELS[f] ?? f}</li>
            ))}
          </ul>

          {h2('Test-Set Accuracy')}
          <p style={{ marginBottom: '12px' }}>
            Both models trained on the same selected features, evaluated on the same held-out year:
          </p>
          <div style={{ width: '100%', height: 220, marginBottom: '8px' }}>
            <ResponsiveContainer>
              <BarChart
                data={[
                  { model: 'Lasso', rmse: data.test_metrics.lasso.rmse },
                  { model: 'Gradient Boosting', rmse: data.test_metrics.gbm.rmse },
                ]}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis dataKey="model" tick={{ fontSize: 13 }} />
                <YAxis tickFormatter={fmtDollar} tick={{ fontSize: 12 }} width={70} />
                <Tooltip formatter={(v: any) => fmtDollar(Number(v))} />
                <Bar dataKey="rmse" name="Test RMSE" radius={[4, 4, 0, 0]}>
                  <Cell fill={PURPLE} />
                  <Cell fill={ORANGE} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p style={{ marginBottom: '20px', fontSize: '14px', color: '#666' }}>
            Lasso: RMSE {fmtDollar(data.test_metrics.lasso.rmse)}, R² {data.test_metrics.lasso.r2.toFixed(2)}.
            Gradient Boosting: RMSE {fmtDollar(data.test_metrics.gbm.rmse)}, R² {data.test_metrics.gbm.r2.toFixed(2)}.
            Lower RMSE and higher R² are better.
          </p>

          {h2('Does More Data Help? Two Kinds of "More"')}
          <p style={{ marginBottom: '16px' }}>
            <strong>More years.</strong> Training on a growing window of years-back, ending right
            before the test year, shows whether extra history helps either model generalize
            forward:
          </p>
          <div style={{ width: '100%', height: 240, marginBottom: '8px' }}>
            <ResponsiveContainer>
              <LineChart data={data.learning_curve_years}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis dataKey="n_training_years" tick={{ fontSize: 12 }} label={{ value: 'Training years used', position: 'insideBottom', offset: -4, fontSize: 12 }} />
                <YAxis tickFormatter={fmtDollar} tick={{ fontSize: 12 }} width={70} />
                <Tooltip formatter={(v: any) => (v == null ? 'n/a' : fmtDollar(Number(v)))} />
                <RechartsLegend />
                <Line type="monotone" dataKey="lasso_rmse" name="Lasso" stroke={PURPLE} strokeWidth={2} connectNulls />
                <Line type="monotone" dataKey="gbm_rmse" name="Gradient Boosting" stroke={ORANGE} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p style={{ marginBottom: '20px', fontSize: '14px', color: '#666' }}>
            Neither model improved with more years here; both got worse as older (2017–2019)
            years were added. The likely reason: 2020–2022&apos;s pandemic-era price boom was a
            regime shift, not a continuation of the pre-2020 trend, so older years taught a
            relationship that no longer held by the test period. Recency mattered more than row
            count for this particular target.
          </p>

          <p style={{ marginBottom: '16px' }}>
            <strong>More features.</strong> Widening the feature set, with training years fixed,
            tells a different story:
          </p>
          <div style={{ width: '100%', height: 240, marginBottom: '8px' }}>
            <ResponsiveContainer>
              <BarChart data={data.learning_curve_features}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis
                  dataKey="feature_group"
                  tick={{ fontSize: 12 }}
                  tickFormatter={(v: string) => ({ core: 'Core (6)', core_plus_acs_extra: '+ ACS extras (17)', forward_selected: 'Forward-selected' }[v] ?? v)}
                />
                <YAxis tickFormatter={fmtDollar} tick={{ fontSize: 12 }} width={70} />
                <Tooltip formatter={(v: any) => fmtDollar(Number(v))} />
                <RechartsLegend />
                <Bar dataKey="lasso_rmse" name="Lasso" fill={PURPLE} radius={[4, 4, 0, 0]} />
                <Bar dataKey="gbm_rmse" name="Gradient Boosting" fill={ORANGE} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p style={{ marginBottom: '20px', fontSize: '14px', color: '#666' }}>
            Adding the extra ACS variables (education, commute, diversity, vacancy, Gini, broadband)
            on top of the 6-variable affordability core noticeably reduced Lasso&apos;s error. More
            columns helped, where more years didn&apos;t. The forward-selected subset gets nearly
            the same accuracy as the full extra set with fewer features, which is the point of
            selecting by cross-validated error rather than including everything available.
          </p>

          {h2('Why Didn’t Boosting Win?')}
          <p style={{ marginBottom: '20px' }}>
            Gradient boosting never beat Lasso, in any configuration tried above. This isn&apos;t a
            tuning failure; it&apos;s the expected outcome at this sample size. With roughly 170
            training rows, a tree ensemble has enough flexibility to fit noise as easily as signal,
            while a regularized linear model&apos;s bias toward simpler relationships is exactly
            what a small, noisy panel needs. Boosting would likely close the gap with meaningfully
            more district-years of history than this pipeline currently has, worth revisiting as
            more annual refreshes accumulate.
          </p>

          {h2('Test-Year Predictions vs. Actual')}
          <p style={{ marginBottom: '12px', fontSize: '14px', color: '#666' }}>
            Error = prediction − actual, so a positive number means the model overshot. The
            smaller (better) of the two errors is bolded in each row.
          </p>
          <div style={{ overflowX: 'auto', marginBottom: '24px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #ddd', textAlign: 'right' }}>
                  <th style={{ textAlign: 'left', padding: '6px 8px' }}>District</th>
                  <th style={{ padding: '6px 8px' }}>Actual</th>
                  <th style={{ padding: '6px 8px' }} colSpan={2}>Lasso</th>
                  <th style={{ padding: '6px 8px' }} colSpan={2}>Gradient Boosting</th>
                </tr>
                <tr style={{ borderBottom: '2px solid #ddd', textAlign: 'right', fontSize: '11px', color: '#888' }}>
                  <th style={{ padding: '0 8px 6px' }} />
                  <th style={{ padding: '0 8px 6px' }} />
                  <th style={{ padding: '0 8px 6px' }}>pred.</th>
                  <th style={{ padding: '0 8px 6px' }}>error</th>
                  <th style={{ padding: '0 8px 6px' }}>pred.</th>
                  <th style={{ padding: '0 8px 6px' }}>error</th>
                </tr>
              </thead>
              <tbody>
                {data.predictions
                  .slice()
                  .sort((a, b) => a.city.localeCompare(b.city) || a.district_id - b.district_id)
                  .map((p) => {
                    const lassoErr = p.lasso_pred - p.actual;
                    const gbmErr = p.gbm_pred - p.actual;
                    const lassoBetter = Math.abs(lassoErr) <= Math.abs(gbmErr);
                    const errCell = (err: number, isBetter: boolean) => (
                      <td
                        style={{
                          padding: '6px 8px',
                          fontWeight: isBetter ? 700 : 400,
                          color: err > 0 ? '#c0392b' : err < 0 ? '#2166ac' : '#666',
                        }}
                      >
                        {err > 0 ? '+' : ''}
                        {fmtDollar(err)}
                      </td>
                    );
                    return (
                      <tr key={`${p.city}-${p.district_id}`} style={{ borderBottom: '1px solid #eee', textAlign: 'right' }}>
                        <td style={{ textAlign: 'left', padding: '6px 8px' }}>
                          {p.city === 'stpaul' ? 'St. Paul' : 'Mpls'} {p.district_id}
                        </td>
                        <td style={{ padding: '6px 8px' }}>{fmtDollar(p.actual)}</td>
                        <td style={{ padding: '6px 8px' }}>{fmtDollar(p.lasso_pred)}</td>
                        {errCell(lassoErr, lassoBetter)}
                        <td style={{ padding: '6px 8px' }}>{fmtDollar(p.gbm_pred)}</td>
                        {errCell(gbmErr, !lassoBetter)}
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
          <p style={{ marginBottom: '20px', fontSize: '13px', color: '#888' }}>
            Red = overpredicted, blue = underpredicted. Bolded error is the closer prediction for
            that district.
          </p>

          {h2('Honest Limitations')}
          <ul style={{ marginBottom: '24px', paddingLeft: '20px' }}>
            <li>28 districts and a handful of years is a small panel; these results describe what worked on this specific dataset, not a general claim that linear models always beat boosting.</li>
            <li>Crime, permits, and OpenStreetMap-derived amenities aren&apos;t included as features: they don&apos;t have a matching year-by-year history over this same window, so adding them as static values would misrepresent them as time-varying.</li>
            <li>A single held-out year is one test, not a distribution; a different test year could rank the models differently.</li>
          </ul>

          <p style={{ fontSize: '13px', color: '#888', marginBottom: '8px' }}>
            See <Link href="/about" style={{ color: PURPLE }}>About</Link> for the Living Quality
            Score methodology, and{' '}
            <code style={{ background: '#f4f4f4', padding: '1px 5px', borderRadius: '3px' }}>
              pipeline/analysis/home_value_prediction/README.md
            </code>{' '}
            for the full write-up and how to regenerate these results.
          </p>
        </>
      )}
    </div>
  );
}
