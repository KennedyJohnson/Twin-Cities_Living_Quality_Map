# Home Value Prediction — An 8-Model Bake-Off

A small model-comparison study built on top of the Living Quality Map's
existing Census pipeline: given a district's features in year *t*, predict
its median home value in year *t+1*, then compare 8 scikit-learn
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
  runs the LOYO bake-off (`MODEL_CANDIDATES`), and fits the top 3 plus
  Gradient Boosting on the most recent fold and two learning-curve sweeps
  (more years / more features). It writes `results.json` (also copied to
  `web/public/data/home_value_prediction.json` for the frontend write-up
  page at `/home-value-model`).

## Method

- **Target:** `median_home_value` in year t+1 from year-t features (a forward prediction, not a same-year correlation).
- **Feature selection:** greedy forward selection on Lasso's leave-one-year-out (LOYO) CV RMSE. Only 2 of 18 candidates survive: this year's home value and bike commute rate.
- **Evaluation:** a full LOYO bake-off. Each model trains on 6 years and tests on the 7th, repeated for all 7 years, and models are ranked by mean RMSE across folds.
- **Models:** Lasso, Ridge, Bayesian Ridge (target standardized, since its default priors over-shrink raw-dollar targets at small n), Gaussian Process, Random Forest, Gradient Boosting, KNN, and SVR. Elastic Net was dropped: CV picked l1_ratio=1 on every fold, which made it identical to Lasso.

## Findings

**Main finding: the neighborhood price gap narrowed from 2017 to 2024** (`convergence_analysis` in `train.py`). This is the lead of the frontend page. The cheapest quarter of districts in 2017 appreciated ~75% by 2024, against ~48% for the priciest. The priciest/cheapest district ratio fell from 3.2x to 2.6x. Cumulative growth correlates with 2017 price (r=-0.64), bachelor's+ share (r=-0.65), and diversity (r=+0.53), all p<0.005 with n=28. The effect is invisible year to year: out-of-sample R^2 for single-year excess growth is below 0. But its sign was consistent in 6 of 7 years, so it compounds. Checks: over 2022-2024, the most recent window whose ACS vintages don't overlap 2017's, the relationship disappears (r=-0.10). So the catch-up was concentrated in the 2017-22/pandemic period and has stalled. Regression to the mean can't be fully ruled out, but bachelor's share (not part of the growth calculation) predicts growth as well as starting price does. The same `home_value_growth_pct` (2017 -> current ACS vintage) is exported by `exports/export_affordability.py` as a map color option.

0. **Headline: public Census data barely beats a naive forecast.** Two feature-free baselines are scored with the same LOYO setup: *No change* (value(t+1) = value(t); RMSE ~$21.7K, R^2 0.944) and *Average growth* (every district grows at the training years' mean rate; RMSE ~$13.4K, R^2 0.979). Lasso (RMSE ~$13.0K, R^2 0.979) is only ~3% better than Average growth. It wins 6 of 7 folds (one-sided sign test p ~0.06, and the folds aren't independent), and it's slightly worse in St. Paul. Only 3 of the 8 model types beat Average growth at all. The high R^2 comes from autocorrelation in price levels, not from district-level growth skill. The frontend page (`/home-value-model`, "Can Public Data Predict Home Prices?") leads with this comparison.

1. **This year's home value is by far the most important feature.** Without it, every model has to reconstruct price level from demographic proxies. Adding it cuts single-fold RMSE by about 75% (~$47K to ~$11K). Adding the other 11 ACS variables on top of it makes every model worse, because at this sample size they add more variance than signal.
2. **The top 3 are Lasso, Bayesian Ridge, and Gaussian Process** (mean LOYO RMSE ~$13.0-13.3K, R^2 ~0.98). They are within ~$300 of each other, and $1-7K ahead of Ridge, SVR, Gradient Boosting, Random Forest, and KNN. With ~170 rows the problem is variance-limited. All three top models control variance explicitly (an L1 penalty, a marginal-likelihood-tuned L2 prior, and a smooth kernel with a noise term). The relationship being learned is close to linear (value(t+1) is roughly growth x value(t)), so the local-split and neighbor models pay a variance cost for flexibility the data doesn't need.
3. **More years helps the top 3** (~$15K at 2 training years down to ~$10K at 6) but not Gradient Boosting, which stays at ~$19K.

**Caveat:** the folds share districts, and consecutive 5-year ACS estimates overlap, so the folds aren't independent. The reported +/- spread understates the true uncertainty.
