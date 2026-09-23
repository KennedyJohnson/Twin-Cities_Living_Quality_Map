# Home Value Prediction — A 9-Model Bake-Off

A small model-comparison study built on top of the Living Quality Map's
existing Census pipeline: given a district's features in year *t*, predict
its median home value in year *t+1*, then compare 9 different scikit-learn
model families on genuinely held-out, forward-in-time data using
leave-one-year-out cross-validation.

This is a standalone analysis, not part of the site's map/score pipeline —
it doesn't run in `build.py` or the scheduled refresh. Run it manually when
you want to regenerate the results.

## Why this exists

The map's own affordability trend charts (`export_affordability_timeseries.py`)
now cover 2017-2024 (widened from an original 2018-2022 at the same time as
this analysis, once more years were confirmed to fetch cleanly — see that
script's comments), but that's still only enough for a line chart, not to
train a model. This analysis pulls the same ACS loader
(`cleaners/clean_housing_price.py`) across 2017-2024 into a dedicated panel
(`fetch_panel.py` -> `data/panel.csv`, committed; 8 years x 28 districts =
224 district-year rows, 7 usable year-over-year transitions).

## Files

- `fetch_panel.py` — builds `data/panel.csv` from the Census API. Needs
  `CENSUS_API_KEY`; only rerun this if you want to refresh the underlying
  data.
- `train.py` — reads `data/panel.csv` (no API key needed), builds
  year-over-year district transitions, runs leave-one-year-out (LOYO)
  cross-validated forward feature selection, then:
  - fits Lasso and Gradient Boosting on one illustrative fold (the most
    recent transition) for a concrete example,
  - runs two learning-curve sweeps (more years / more features),
  - runs a full LOYO bake-off of 9 model families (`MODEL_CANDIDATES`),
    each evaluated on *all 7* years as the held-out fold, not just one —
  and writes `results.json` (also copied to
  `web/public/data/home_value_prediction.json` for the frontend write-up
  page at `/home-value-model`).

## Method summary

- **Target:** `median_home_value` in year t+1, predicted from year t
  features — a real forward prediction, not same-year correlation.
- **Feature selection:** greedy forward selection — starting from a
  mean-only baseline, repeatedly adds whichever remaining candidate most
  improves LOYO CV RMSE on the training years (years before the final
  transition), stopping once no remaining feature helps.
- **Evaluation — leave-one-year-out across all years, not a single test
  split:** an earlier version of this analysis evaluated only on the most
  recent transition (2023->2024). A single held-out year is one test, not
  a distribution — a different test year could rank the models
  differently. `run_model_bakeoff` now trains each model on 6 years and
  tests on the 7th, once for *every* year, and ranks by mean RMSE across
  all 7 folds (with std/min/max reported too). The single-fold Lasso vs.
  GBM comparison is kept in the results/page as one concrete illustration,
  not as the primary evidence.
- **Models compared:** Lasso, Ridge, Elastic Net, Bayesian Ridge, Gradient
  Boosting, Random Forest, K-Nearest Neighbors, Support Vector Regression
  (RBF kernel), and Gaussian Process Regression — see `MODEL_CANDIDATES` in
  `train.py`.

## The single biggest finding: this year's own value belongs in the feature set

An earlier version of this analysis omitted `median_home_value` itself from
the candidate features, forcing every model to reconstruct a district's
absolute price level entirely from unrelated demographic proxies (income,
rent, poverty rate, etc.). Adding it back as a candidate feature (it's
forward-selected immediately, alongside one other variable) dropped Lasso's
single-fold test RMSE from **$34,779 to ~$10,400** (R^2 0.89 -> 0.99) — by
far the largest lever in the whole analysis, well ahead of any model-family
choice. Home values are highly autocorrelated year to year, so this is the
standard "predict the return, not the level" framing used in real
estate/finance forecasting, just expressed as a feature rather than a
change of target variable. It also flipped an earlier (now outdated)
finding that more training years hurt — with the dominant, stable
autoregressive signal now available to anchor on, more years steadily
*improve* Lasso instead.

## Which models actually win, and why

Ranked by mean RMSE across all 7 leave-one-year-out folds, the top 3 are
consistently **Lasso/Elastic Net, Bayesian Ridge, and Gaussian Process
Regression** — all beating Gradient Boosting, Random Forest, SVR, and KNN
in every configuration tried. This isn't a general claim that linear models
beat tree ensembles; it's specific to how little data this panel has
(~170-190 rows depending on the fold):

- **Lasso / Elastic Net** shrink weak or collinear coefficients toward
  zero, which is exactly the right correction when predictors (income,
  rent, cost burden) move together and there isn't enough data to estimate
  each one's independent effect reliably.
- **Bayesian Ridge** infers its own regularization strength from a
  probabilistic prior rather than tuning it against the data, making it
  naturally conservative on a small panel.
- **Gaussian Process Regression** (RBF + white-noise kernel) predicts each
  district as a similarity-weighted average of its nearest training
  districts in feature space, with the kernel's noise term absorbing
  measurement noise instead of fitting it — a standard choice for
  small-sample regression, and one that also gives calibrated uncertainty
  estimates for free.
- **Gradient Boosting, Random Forest, and KNN** all build predictions out
  of local, data-driven splits/neighborhoods, which needs enough repeated
  examples of any one local pattern to distinguish signal from noise. At
  this sample size there usually isn't, so the extra flexibility mostly
  adds variance instead of paying off. Revisit this ranking once
  meaningfully more district-years of history have accumulated.

See `results.json`'s `model_bakeoff` array (or the frontend page) for the
exact numbers per model and per fold.
