# Home Value Prediction — Lasso vs. Gradient Boosting

A small model-comparison study built on top of the Living Quality Map's
existing Census pipeline: given a district's features in year *t*, predict
its median home value in year *t+1*, then compare a regularized linear
model (Lasso) against gradient-boosted trees (scikit-learn's
`GradientBoostingRegressor`) on genuinely held-out, forward-in-time data.

This is a standalone analysis, not part of the site's map/score pipeline —
it doesn't run in `build.py` or the scheduled refresh. Run it manually when
you want to regenerate the results.

## Why this exists

The map's own affordability trend charts (`export_affordability_timeseries.py`)
only cover 2018-2022 (5 years) because that's what the frontend needs for a
simple line chart. This analysis needed more training rows than that, so
`fetch_panel.py` pulls the same ACS loader (`cleaners/clean_housing_price.py`)
across 2017-2024 instead (2017 is the earliest year all the ACS variables
here — including broadband, added to ACS in the 2017 5-year vintage — are
available under stable variable codes). That's 8 years x 28 districts = 224
district-year rows, vs. the 5 years the site's own charts have.

## Files

- `fetch_panel.py` — builds `data/panel.csv` (committed; ~230 rows, a few
  KB) from the Census API. Needs `CENSUS_API_KEY`; only rerun this if you
  want to refresh the underlying data.
- `train.py` — reads `data/panel.csv` (no API key needed), builds
  year-over-year district transitions, runs leave-one-year-out
  cross-validated forward feature selection, fits the final Lasso and GBM
  models, evaluates both against the held-out 2023->2024 transition, runs
  two learning-curve sweeps (more years / more features), and writes
  `results.json` (also copied to `web/public/data/home_value_prediction.json`
  for the frontend write-up page at `/home-value-model`).

## Method summary

- **Target:** `median_home_value` in year t+1, predicted from year t
  features — a real forward prediction, not same-year correlation.
- **Test set:** the single most recent transition (2023 -> 2024), never
  touched during feature selection or hyperparameter choices.
- **Feature selection:** greedy forward selection — starting from a
  mean-only baseline, repeatedly adds whichever remaining candidate most
  improves leave-one-year-out CV RMSE on the training years, stopping once
  no remaining feature helps. This is deliberate: with only ~170 training
  rows, adding every available ACS column unconditionally would just add
  noise, so features have to earn inclusion via cross-validated error, not
  availability.
- **Models:** `LassoCV` (auto-tuned alpha, standardized features) vs.
  `GradientBoostingRegressor` (max_depth=2, learning_rate=0.05,
  n_estimators=80 — capped deliberately small given the sample size).

## What the results actually show (see `results.json` / the frontend page for numbers)

Two findings worth calling out because they run against the "more data is
always better" intuition, and reporting them honestly is more interesting
than only reporting whichever number looks best:

- **Gradient boosting doesn't beat Lasso here, at any training-set size or
  feature set tried.** With ~170 rows, the regularized linear model
  consistently wins. This matches the general small-N rule: tree ensembles
  need more rows than this to earn their extra flexibility.
- **More training *years* didn't help either model** — both models'
  held-out RMSE was lowest with only the 1-2 most recent training years and
  got worse as older years (2017-2019) were added. The likely explanation:
  the 2020-2022 pandemic-era price boom was a regime shift, not a
  continuation of the pre-2020 trend, so older years taught the model a
  relationship that no longer held by the 2023->2024 test period. Recency
  mattered more than raw row count. More training **features** (widening
  from the 6-column affordability core to the fuller ACS set) *did* help —
  that sweep is the one where "more data" paid off.
