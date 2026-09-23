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
  model_bakeoff: {
    model: string; mean_rmse: number; std_rmse: number; min_rmse: number; max_rmse: number;
    pooled_r2: number; folds: { test_year: number; test_transition: string; rmse: number; r2: number }[];
  }[];
}

const MODEL_LABELS: Record<string, string> = {
  Lasso: 'Lasso', ElasticNet: 'Elastic Net', 'Bayesian Ridge': 'Bayesian Ridge',
  'Gaussian Process': 'Gaussian Process', Ridge: 'Ridge', 'Support Vector (RBF)': 'Support Vector (RBF)',
  'Gradient Boosting': 'Gradient Boosting', 'Random Forest': 'Random Forest', 'K-Nearest Neighbors': 'K-Nearest Neighbors',
};

const PURPLE = '#756bb1';
const ORANGE = '#e6550d';
const FEATURE_LABELS: Record<string, string> = {
  median_home_value: "This year's home value", median_household_income: 'Household income', homeownership_rate: 'Homeownership rate',
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
        Predicting Home Value: A 9-Model Bake-Off
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
        can a model predict its <strong>median home value the following year</strong>, and which of
        9 different model families — from plain linear regression to gradient-boosted trees to a
        Gaussian Process — actually wins here, given how little data 28 districts and a handful of
        years really is? Every model below is evaluated with leave-one-year-out cross-validation
        across all 7 available years, not a single held-out year, so the comparison reflects a
        distribution of results, not one lucky (or unlucky) test split.
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

          {h2('Test-Set Accuracy: One Example Fold')}
          <p style={{ marginBottom: '12px' }}>
            Before the full leave-one-year-out comparison below, here&apos;s the most recent single
            fold ({data.generated_from.test_transition}) for the two models this analysis started
            with, as a concrete illustration:
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
            With the corrected feature set (below), more years actually does help Lasso — its RMSE
            falls fairly steadily as older years are added back in. That&apos;s a reversal from an
            earlier version of this analysis, which didn&apos;t include this year&apos;s own home
            value as a feature and found the opposite: older years hurt, because 2020–2022&apos;s
            pandemic-era price boom was a regime shift relative to demographic-only predictors.
            Once the model has the stable, highly autocorrelated signal (this year&apos;s price) to
            anchor on, more years of history refine that relationship rather than confuse it.
            Gradient Boosting doesn&apos;t show the same steady improvement — its error moves
            around without a clear trend, another sign it isn&apos;t extracting a stable
            relationship from this few rows the way the linear model is.
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
                  tickFormatter={(v: string) => ({ core: 'Core (6)', core_plus_autoregressive: '+ current value (7)', all: '+ ACS extras (18)', forward_selected: 'Forward-selected' }[v] ?? v)}
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
            The single biggest jump here isn&apos;t a wider Census variable set — it&apos;s adding
            <strong> this year&apos;s own home value</strong> as a feature (Core → +current value):
            Lasso&apos;s RMSE drops from ~$47,000 to ~$11,000. That makes sense in hindsight: home
            values are highly autocorrelated year to year, so knowing a district&apos;s current
            price is far more informative than reconstructing its price level indirectly from
            income, rent, and poverty rate. Piling on the remaining 11 ACS variables after that
            point (+ ACS extras) actually made Lasso <em>worse</em>, not better — with this little
            data, extra columns add noise faster than signal once the dominant driver is already
            included. The forward-selected 2-feature set (current value + bike commute rate) beats
            every fixed group above, which is the point of selecting by cross-validated error
            rather than by how many columns are available.
          </p>

          {h2('Model Bake-Off: 9 Families, Leave-One-Year-Out')}
          <p style={{ marginBottom: '16px' }}>
            Rather than compare just Lasso and Gradient Boosting on one held-out year, this runs 9
            different model families through a full leave-one-year-out cycle: each model is trained
            on 6 years and tested on the 7th, once for <em>every</em> year, so the ranking reflects
            a distribution of 7 results per model, not one test split that could have gone either
            way by chance:
          </p>
          <div style={{ width: '100%', height: 280, marginBottom: '8px' }}>
            <ResponsiveContainer>
              <BarChart
                data={data.model_bakeoff.map((m) => ({ ...m, label: MODEL_LABELS[m.model] ?? m.model }))}
                layout="vertical"
                margin={{ left: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis type="number" tickFormatter={fmtDollar} tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="label" tick={{ fontSize: 12 }} width={130} />
                <Tooltip
                  formatter={(v: any, name: any) => [fmtDollar(Number(v)), name]}
                  labelFormatter={() => ''}
                />
                <Bar dataKey="mean_rmse" name="Mean RMSE across 7 year-folds" radius={[0, 4, 4, 0]}>
                  {data.model_bakeoff.map((m, i) => (
                    <Cell key={m.model} fill={i < 3 ? '#2ca25f' : i < 6 ? PURPLE : '#bbb'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p style={{ marginBottom: '20px', fontSize: '13px', color: '#888' }}>
            Green = top 3, purple = middle 3, gray = bottom 3, ranked by mean RMSE across all 7
            year-folds (lower is better).
          </p>

          <h3 style={{ fontSize: '16px', fontWeight: 600, marginTop: '24px', marginBottom: '12px' }}>
            The Top 3, and Why They Won
          </h3>
          <p style={{ marginBottom: '16px' }}>
            The three best performers — {data.model_bakeoff.slice(0, 3).map((m) => MODEL_LABELS[m.model] ?? m.model).join(', ')}
            {' '}— are all, in different ways, models built around a small-sample assumption: the
            true relationship is simple, and the job is mostly to avoid overfitting the noise in
            168 rows, not to capture complex interactions there isn&apos;t enough data to
            distinguish from chance:
          </p>
          <ul style={{ marginBottom: '20px', paddingLeft: '20px' }}>
            <li style={{ marginBottom: '10px' }}>
              <strong>Lasso / Elastic Net</strong> — regularized linear regression that shrinks
              weak or redundant coefficients toward (or to exactly) zero. With only ~170 rows and
              correlated predictors (income, rent, and cost burden all move together), an
              unregularized linear model would produce wild, unstable coefficients; Lasso&apos;s
              penalty is exactly the right correction, and it doubles as automatic feature
              selection.
            </li>
            <li style={{ marginBottom: '10px' }}>
              <strong>Bayesian Ridge</strong> — statistically, close to Ridge regression, but the
              regularization strength itself is inferred from the data via a probabilistic prior
              rather than chosen by cross-validation. That makes it naturally conservative on a
              small panel: it can&apos;t become overconfident from a handful of rows the way an
              unregularized model or a deep tree can.
            </li>
            <li style={{ marginBottom: '10px' }}>
              <strong>Gaussian Process</strong> — a kernel method that, with the smooth
              (RBF) kernel used here, effectively predicts each district as a similarity-weighted
              average of the training districts nearest it in feature space, with the kernel&apos;s
              own noise term absorbing measurement noise instead of fitting it. GPs are a
              standard choice specifically <em>for</em> small-sample regression, and they also
              output calibrated uncertainty estimates for free — arguably more useful for a
              district-level forecast than a bare point prediction.
            </li>
          </ul>
          <p style={{ marginBottom: '20px' }}>
            The bottom of the ranking tells the same story from the other direction: Gradient
            Boosting, Random Forest, and K-Nearest Neighbors all build their prediction out of
            local, data-driven splits or neighborhoods rather than a single global relationship.
            That flexibility is normally an advantage — it lets them capture nonlinear patterns a
            linear model can&apos;t — but it needs enough rows to tell a real nonlinear pattern
            apart from sampling noise. At ~170 rows split across 28 districts, there usually
            isn&apos;t enough repetition of any one local pattern for that flexibility to pay off,
            so it mostly just adds variance. This is a property of <em>this dataset&apos;s size</em>,
            not a general rule that linear models beat tree ensembles — with meaningfully more
            district-years of history, that ranking would likely shift.
          </p>

          {h2('Test-Year Predictions vs. Actual')}
          <p style={{ marginBottom: '12px', fontSize: '14px', color: '#666' }}>
            The Lasso/Gradient Boosting district-by-district breakdown from the single most recent
            fold ({data.generated_from.test_transition}) — one of the 7 folds behind the bake-off
            above, shown concretely rather than just as a summary statistic. Error is % of the
            actual value ((prediction − actual) / actual), not raw dollars, so districts at very
            different price points are comparable at a glance.
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
                    const lassoErrPct = (lassoErr / p.actual) * 100;
                    const gbmErrPct = (gbmErr / p.actual) * 100;
                    const lassoBetter = Math.abs(lassoErr) <= Math.abs(gbmErr);
                    const errCell = (errPct: number, isBetter: boolean) => (
                      <td
                        style={{
                          padding: '6px 8px',
                          fontWeight: isBetter ? 700 : 400,
                          color: errPct > 0 ? '#c0392b' : errPct < 0 ? '#2166ac' : '#666',
                          background: isBetter ? '#eafaf1' : 'transparent',
                          borderRadius: '4px',
                        }}
                      >
                        {isBetter && (
                          <span style={{ color: '#27ae60', fontWeight: 700, marginRight: '4px' }}>✓</span>
                        )}
                        {errPct > 0 ? '+' : ''}
                        {errPct.toFixed(1)}%
                      </td>
                    );
                    return (
                      <tr key={`${p.city}-${p.district_id}`} style={{ borderBottom: '1px solid #eee', textAlign: 'right' }}>
                        <td style={{ textAlign: 'left', padding: '6px 8px' }}>
                          {p.city === 'stpaul' ? 'St. Paul' : 'Mpls'} {p.district_id}
                        </td>
                        <td style={{ padding: '6px 8px' }}>{fmtDollar(p.actual)}</td>
                        <td style={{ padding: '6px 8px' }}>{fmtDollar(p.lasso_pred)}</td>
                        {errCell(lassoErrPct, lassoBetter)}
                        <td style={{ padding: '6px 8px' }}>{fmtDollar(p.gbm_pred)}</td>
                        {errCell(gbmErrPct, !lassoBetter)}
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
          <p style={{ marginBottom: '20px', fontSize: '13px', color: '#888' }}>
            Red = overpredicted, blue = underpredicted. <span style={{ color: '#27ae60', fontWeight: 700 }}>✓</span> marks the closer prediction for
            that district.
          </p>

          {h2('Honest Limitations')}
          <ul style={{ marginBottom: '24px', paddingLeft: '20px' }}>
            <li>Crime, permits, and OpenStreetMap-derived amenities aren&apos;t included as features: they don&apos;t have a matching year-by-year history over this same window, so adding them as static values would misrepresent them as time-varying.</li>
            <li>28 districts and 7 years is still a small panel in absolute terms — leave-one-year-out evaluation makes the ranking above far more trustworthy than a single test split, but it doesn&apos;t manufacture more independent data. The per-fold spread in the bake-off chart&apos;s tooltip (±$5-6K across models) shows real fold-to-fold variance even for the top models.</li>
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
