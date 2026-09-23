"""
Compare Lasso regression vs. gradient-boosted trees for predicting next-year
median home value per district, using the district-year panel built by
fetch_panel.py (analysis/home_value_prediction/data/panel.csv, 2017-2024,
28 districts).

Framing:
- One row = one district-year "transition": features observed in year t
  predict median_home_value in year t+1. This is a genuine forward-in-time
  prediction, not same-year correlation.
- Test set = the most recent complete transition (2023 -> 2024). Never
  touched until final evaluation.
- Train/validation = all earlier transitions (2017->18 ... 2022->23).
  Feature selection and hyperparameters are chosen by leave-one-year-out
  CV *within* this training set only.
- Two sweeps answer "does more data help, and which kind": (A) train on an
  increasing number of years-back, fixed test year, to see whether more
  years narrows the gap between Lasso and gradient boosting; (B) train on
  an increasing feature set (affordability core -> + ACS extras -> + all
  context features), fixed years, to see which features actually reduce
  held-out error vs. just adding noise.

Output: analysis/home_value_prediction/results.json (also copied to
web/public/data/home_value_prediction.json for the frontend write-up page).

Run: python train.py
"""

import sys
from pathlib import Path as _BootstrapPath
sys.path.insert(0, str(_BootstrapPath(__file__).resolve().parent.parent.parent))

import json
import numpy as np
import pandas as pd
from pathlib import Path

from sklearn.linear_model import LassoCV, Lasso, Ridge, ElasticNetCV, BayesianRidge
from sklearn.ensemble import GradientBoostingRegressor, RandomForestRegressor
from sklearn.svm import SVR
from sklearn.neighbors import KNeighborsRegressor
from sklearn.gaussian_process import GaussianProcessRegressor
from sklearn.gaussian_process.kernels import RBF, WhiteKernel, ConstantKernel
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import mean_squared_error, mean_absolute_error, r2_score

DATA_DIR = Path(__file__).resolve().parent / "data"
OUT_FILE = Path(__file__).resolve().parent / "results.json"
WEB_OUT_FILE = Path(__file__).resolve().parent.parent.parent.parent / "web" / "public" / "data" / "home_value_prediction.json"

TARGET = "median_home_value"

# Feature groups, from narrowest to widest. "core" mirrors what the
# frontend's affordability_timeseries_*.json already exposes (2018-2022,
# 5 years) — the baseline this analysis is meant to beat with more years
# and more columns. "acs_extra" adds ACS variables newly pulled for this
# analysis (education, age, commute, diversity, vacancy, Gini, broadband).
# "context" would add non-ACS pipeline sources (crime, walk score, etc.)
# but those don't have a matching year-by-year history (see CLAUDE.md's
# Data Science Extensions note) so are intentionally left out here rather
# than faked as time-varying.
FEATURE_GROUPS = {
    "core": [
        "median_gross_rent", "median_household_income", "poverty_rate",
        "housing_cost_burden_rate", "homeownership_rate", "unemployment_rate_pc",
    ],
    # This year's own home value, as a feature for predicting next year's.
    # An earlier version of this analysis omitted it, forcing every model
    # to reconstruct a district's absolute price level entirely from
    # unrelated demographic proxies. Adding it back (2026-09-22) dropped
    # Lasso's test RMSE from $34,779 to ~$10,400 (R^2 0.89 -> 0.99) -- by
    # far the single biggest lever in this whole analysis, well ahead of
    # any model-family choice below. Home values are highly autocorrelated
    # year to year, so this is the standard "predict the return, not the
    # level" framing used in real-estate/finance forecasting, just
    # expressed as a feature rather than a change of target variable.
    "autoregressive": ["median_home_value"],
    "acs_extra": [
        "gini_index", "vacancy_rate", "broadband_rate", "bachelors_rate",
        "median_age", "avg_commute_min", "transit_commute_rate",
        "walk_commute_rate", "bike_commute_rate", "wfh_rate", "diversity_index",
    ],
}
FEATURE_GROUPS["core_plus_acs_extra"] = FEATURE_GROUPS["core"] + FEATURE_GROUPS["acs_extra"]
FEATURE_GROUPS["core_plus_autoregressive"] = FEATURE_GROUPS["core"] + FEATURE_GROUPS["autoregressive"]
FEATURE_GROUPS["all"] = FEATURE_GROUPS["core"] + FEATURE_GROUPS["autoregressive"] + FEATURE_GROUPS["acs_extra"]
ALL_CANDIDATE_FEATURES = FEATURE_GROUPS["all"]


def load_transitions():
    """Build one row per (city, district_id, year_t) with year_t features
    plus year_(t+1) median_home_value as the label, and the raw pct change
    as `appreciation_pct` for reference."""
    panel = pd.read_csv(DATA_DIR / "panel.csv")
    panel = panel.sort_values(["city", "district_id", "year"])

    rows = []
    for (city, district_id), group in panel.groupby(["city", "district_id"]):
        group = group.set_index("year")
        years = sorted(group.index)
        for y in years:
            if y + 1 not in years:
                continue
            row = {"city": city, "district_id": district_id, "year": y, "target_year": y + 1}
            for col in ALL_CANDIDATE_FEATURES + [TARGET]:
                row[col] = group.loc[y, col]
            row["label"] = group.loc[y + 1, TARGET]
            row["appreciation_pct"] = round(
                (group.loc[y + 1, TARGET] - group.loc[y, TARGET]) / group.loc[y, TARGET] * 100, 2
            )
            rows.append(row)
    return pd.DataFrame(rows)


def rmse(y_true, y_pred):
    return float(np.sqrt(mean_squared_error(y_true, y_pred)))


def loyo_cv_error(df, features, alpha=None):
    """Leave-one-year-out CV within the training years only. Returns mean
    RMSE across folds. If alpha is None, fits LassoCV per fold (picks its
    own alpha); otherwise fits Lasso at the given alpha."""
    years = sorted(df["year"].unique())
    fold_rmses = []
    for held_out_year in years:
        train = df[df["year"] != held_out_year]
        val = df[df["year"] == held_out_year]
        if val.empty or train.empty:
            continue
        scaler = StandardScaler()
        X_train = scaler.fit_transform(train[features])
        X_val = scaler.transform(val[features])
        if alpha is None:
            model = LassoCV(cv=min(5, len(train["year"].unique())), max_iter=20000, random_state=0)
        else:
            model = Lasso(alpha=alpha, max_iter=20000, random_state=0)
        model.fit(X_train, train["label"])
        pred = model.predict(X_val)
        fold_rmses.append(rmse(val["label"], pred))
    return float(np.mean(fold_rmses)) if fold_rmses else None


def forward_select_features(train_df, candidates):
    """Greedy forward selection: repeatedly add whichever remaining
    feature most improves leave-one-year-out CV RMSE (within training
    years only), stopping once no remaining feature improves it. This is
    the "only add variables that reduce error" step — each addition has
    to earn its place via cross-validated error, not just be included
    because it's available."""
    selected = []
    remaining = list(candidates)
    best_rmse = loyo_cv_error(train_df, ["median_household_income"]) if False else None
    # Start from an empty model's baseline: predict the training mean.
    baseline_rmse = float(np.sqrt(np.mean((train_df["label"] - train_df["label"].mean()) ** 2)))
    best_rmse = baseline_rmse
    history = [{"step": 0, "added": None, "features": [], "cv_rmse": round(baseline_rmse, 1)}]

    step = 0
    while remaining:
        step += 1
        scored = []
        for feat in remaining:
            trial_features = selected + [feat]
            err = loyo_cv_error(train_df, trial_features)
            if err is not None:
                scored.append((err, feat))
        if not scored:
            break
        scored.sort()
        best_new_rmse, best_feat = scored[0]
        if best_new_rmse < best_rmse - 1e-6:
            selected.append(best_feat)
            remaining.remove(best_feat)
            best_rmse = best_new_rmse
            history.append({
                "step": step, "added": best_feat,
                "features": list(selected), "cv_rmse": round(best_rmse, 1),
            })
        else:
            break
    return selected, history


def fit_final_lasso(train_df, features):
    scaler = StandardScaler()
    X = scaler.fit_transform(train_df[features])
    model = LassoCV(cv=min(5, len(train_df["year"].unique())), max_iter=20000, random_state=0)
    model.fit(X, train_df["label"])
    return model, scaler


def fit_final_gbm(train_df, features, n_estimators=80, max_depth=2, learning_rate=0.05):
    model = GradientBoostingRegressor(
        n_estimators=n_estimators, max_depth=max_depth, learning_rate=learning_rate,
        subsample=0.8, random_state=0,
    )
    model.fit(train_df[features], train_df["label"])
    return model


def evaluate(model, scaler, df, features, is_lasso):
    X = scaler.transform(df[features]) if is_lasso else df[features]
    pred = model.predict(X)
    return {
        "rmse": rmse(df["label"], pred),
        "mae": float(mean_absolute_error(df["label"], pred)),
        "r2": float(r2_score(df["label"], pred)),
    }, pred


# Model bake-off: beyond Lasso vs. GBM, try a handful of other model
# families that are each, for different reasons, suited to a small (~170
# row), noisy, tabular panel like this one -- and a couple that are
# included specifically as a contrast because they *aren't* well suited to
# it, so the comparison itself is informative. `needs_scaling` mirrors
# Lasso: distance/kernel-based and penalized-linear models need
# standardized inputs, tree ensembles don't.
MODEL_CANDIDATES = {
    "Lasso": (True, lambda: LassoCV(cv=5, max_iter=20000, random_state=0)),
    "Ridge": (True, lambda: Ridge(alpha=10.0, random_state=0)),
    "ElasticNet": (True, lambda: ElasticNetCV(cv=5, l1_ratio=[.1, .5, .7, .9, 1], max_iter=20000, random_state=0)),
    "Bayesian Ridge": (True, lambda: BayesianRidge()),
    "Random Forest": (False, lambda: RandomForestRegressor(n_estimators=200, max_depth=4, min_samples_leaf=2, random_state=0)),
    "Gradient Boosting": (False, lambda: GradientBoostingRegressor(n_estimators=80, max_depth=2, learning_rate=0.05, subsample=0.8, random_state=0)),
    "K-Nearest Neighbors": (True, lambda: KNeighborsRegressor(n_neighbors=5, weights="distance")),
    "Support Vector (RBF)": (True, lambda: SVR(kernel="rbf", C=1e5, epsilon=1000)),
    "Gaussian Process": (True, lambda: GaussianProcessRegressor(
        kernel=ConstantKernel(1.0) * RBF(length_scale=1.0) + WhiteKernel(noise_level=1.0),
        normalize_y=True, n_restarts_optimizer=3, random_state=0,
    )),
}


def loyo_cv_error_generic(df, features, needs_scaling, model_factory):
    """Leave-one-year-out CV for an arbitrary sklearn-style regressor."""
    years = sorted(df["year"].unique())
    fold_rmses = []
    for held_out_year in years:
        train = df[df["year"] != held_out_year]
        val = df[df["year"] == held_out_year]
        if val.empty or train.empty:
            continue
        if needs_scaling:
            scaler = StandardScaler()
            X_train = scaler.fit_transform(train[features])
            X_val = scaler.transform(val[features])
        else:
            X_train, X_val = train[features], val[features]
        model = model_factory()
        model.fit(X_train, train["label"])
        fold_rmses.append(rmse(val["label"], model.predict(X_val)))
    return float(np.mean(fold_rmses)) if fold_rmses else None


def full_loyo_evaluation(full_df, features, needs_scaling, model_factory):
    """Evaluate a model across EVERY year as its own held-out test fold
    (leave-one-year-out), not just the single most recent year. A single
    held-out year is one test, not a distribution -- a model can look
    good or bad on any one year by chance. This runs the full LOYO cycle
    (fit on the other 6 years, test on the 7th) for each of the 7
    available years and reports the per-year results plus mean/std across
    them, which is the primary metric used for ranking models below."""
    years = sorted(full_df["year"].unique())
    folds = []
    all_true, all_pred = [], []
    for held_out_year in years:
        train = full_df[full_df["year"] != held_out_year]
        test = full_df[full_df["year"] == held_out_year]
        if needs_scaling:
            scaler = StandardScaler()
            X_train = scaler.fit_transform(train[features])
            X_test = scaler.transform(test[features])
        else:
            X_train, X_test = train[features], test[features]
        model = model_factory()
        model.fit(X_train, train["label"])
        pred = model.predict(X_test)
        fold_rmse = rmse(test["label"], pred)
        folds.append({
            "test_year": int(held_out_year),
            "test_transition": f"{held_out_year} -> {held_out_year + 1}",
            "rmse": round(fold_rmse, 1),
            "r2": round(float(r2_score(test["label"], pred)), 3),
        })
        all_true.extend(test["label"].tolist())
        all_pred.extend(pred.tolist())
    fold_rmses = [f["rmse"] for f in folds]
    return {
        "folds": folds,
        "mean_rmse": round(float(np.mean(fold_rmses)), 1),
        "std_rmse": round(float(np.std(fold_rmses)), 1),
        "min_rmse": round(float(np.min(fold_rmses)), 1),
        "max_rmse": round(float(np.max(fold_rmses)), 1),
        "pooled_r2": round(float(r2_score(all_true, all_pred)), 3),
    }


def run_model_bakeoff(full_df, features):
    """Run the full leave-one-year-out evaluation for every candidate in
    MODEL_CANDIDATES on the same feature set, ranked by mean RMSE across
    all 7 year-folds (not a single held-out year)."""
    results = []
    for name, (needs_scaling, factory) in MODEL_CANDIDATES.items():
        loyo = full_loyo_evaluation(full_df, features, needs_scaling, factory)
        results.append({
            "model": name,
            "mean_rmse": loyo["mean_rmse"],
            "std_rmse": loyo["std_rmse"],
            "min_rmse": loyo["min_rmse"],
            "max_rmse": loyo["max_rmse"],
            "pooled_r2": loyo["pooled_r2"],
            "folds": loyo["folds"],
        })
    results.sort(key=lambda r: r["mean_rmse"])
    return results


def learning_curve_years(all_train_df, test_df, features):
    """Sweep A: train on the most recent N training transitions, N = 1..all,
    fixed test set and feature set. Shows whether more years narrows the
    Lasso vs. GBM gap."""
    years = sorted(all_train_df["year"].unique())
    curve = []
    for n in range(1, len(years) + 1):
        years_used = years[-n:]
        sub = all_train_df[all_train_df["year"].isin(years_used)]
        if sub["year"].nunique() < 2:
            # LassoCV needs >=2 folds; skip N=1 for the CV-tuned model,
            # but a plain Lasso/GBM fit still works, so still report GBM.
            lasso_metrics = None
        else:
            lasso_model, lasso_scaler = fit_final_lasso(sub, features)
            lasso_metrics, _ = evaluate(lasso_model, lasso_scaler, test_df, features, is_lasso=True)
        gbm_model = fit_final_gbm(sub, features)
        gbm_metrics, _ = evaluate(gbm_model, None, test_df, features, is_lasso=False)
        curve.append({
            "n_training_years": n,
            "training_rows": len(sub),
            "lasso_rmse": round(lasso_metrics["rmse"], 1) if lasso_metrics else None,
            "gbm_rmse": round(gbm_metrics["rmse"], 1),
        })
    return curve


def learning_curve_features(all_train_df, test_df):
    """Sweep B: train on increasingly wide feature groups, fixed years."""
    curve = []
    for group_name in ["core", "core_plus_autoregressive", "all"]:
        features = FEATURE_GROUPS[group_name]
        lasso_model, lasso_scaler = fit_final_lasso(all_train_df, features)
        lasso_metrics, _ = evaluate(lasso_model, lasso_scaler, test_df, features, is_lasso=True)
        gbm_model = fit_final_gbm(all_train_df, features)
        gbm_metrics, _ = evaluate(gbm_model, None, test_df, features, is_lasso=False)
        curve.append({
            "feature_group": group_name,
            "n_features": len(features),
            "lasso_rmse": round(lasso_metrics["rmse"], 1),
            "gbm_rmse": round(gbm_metrics["rmse"], 1),
        })
    # Also the forward-selected subset, for comparison against the two
    # fixed groups above.
    selected, _ = forward_select_features(all_train_df, ALL_CANDIDATE_FEATURES)
    if selected:
        lasso_model, lasso_scaler = fit_final_lasso(all_train_df, selected)
        lasso_metrics, _ = evaluate(lasso_model, lasso_scaler, test_df, selected, is_lasso=True)
        gbm_model = fit_final_gbm(all_train_df, selected)
        gbm_metrics, _ = evaluate(gbm_model, None, test_df, selected, is_lasso=False)
        curve.append({
            "feature_group": "forward_selected",
            "n_features": len(selected),
            "lasso_rmse": round(lasso_metrics["rmse"], 1),
            "gbm_rmse": round(gbm_metrics["rmse"], 1),
        })
    return curve


def main():
    df = load_transitions()
    test_year = df["year"].max()  # most recent complete transition (2023 -> 2024)
    train_df = df[df["year"] < test_year].reset_index(drop=True)
    test_df = df[df["year"] == test_year].reset_index(drop=True)

    print(f"Train: {len(train_df)} rows ({sorted(train_df['year'].unique())})")
    print(f"Test: {len(test_df)} rows (year {test_year} -> {test_year + 1})")

    print("\nForward feature selection (leave-one-year-out CV on training years)...")
    selected_features, selection_history = forward_select_features(train_df, ALL_CANDIDATE_FEATURES)
    print(f"Selected: {selected_features}")

    print("\nFitting final models on selected features...")
    lasso_model, lasso_scaler = fit_final_lasso(train_df, selected_features)
    lasso_test_metrics, lasso_pred = evaluate(lasso_model, lasso_scaler, test_df, selected_features, is_lasso=True)

    gbm_model = fit_final_gbm(train_df, selected_features)
    gbm_test_metrics, gbm_pred = evaluate(gbm_model, None, test_df, selected_features, is_lasso=False)

    print(f"Lasso test RMSE: ${lasso_test_metrics['rmse']:,.0f}  R2: {lasso_test_metrics['r2']:.3f}")
    print(f"GBM   test RMSE: ${gbm_test_metrics['rmse']:,.0f}  R2: {gbm_test_metrics['r2']:.3f}")

    print("\nLearning curve A (years)...")
    curve_years = learning_curve_years(train_df, test_df, selected_features)

    print("Learning curve B (feature groups)...")
    curve_features = learning_curve_features(train_df, test_df)

    print("\nModel bake-off: leave-one-year-out across all 7 years (9 model families)...")
    bakeoff = run_model_bakeoff(df, selected_features)
    for r in bakeoff:
        print(f"  {r['model']:<22} mean RMSE ${r['mean_rmse']:>10,.0f} (+/- ${r['std_rmse']:,.0f})  pooled R2 {r['pooled_r2']:.3f}")

    lasso_coefs = {
        feat: round(float(coef), 1)
        for feat, coef in zip(selected_features, lasso_model.coef_)
    }
    gbm_importances = {
        feat: round(float(imp), 4)
        for feat, imp in zip(selected_features, gbm_model.feature_importances_)
    }

    predictions = []
    for i, row in test_df.iterrows():
        predictions.append({
            "city": row["city"],
            "district_id": int(row["district_id"]),
            "actual": round(float(row["label"]), 0),
            "lasso_pred": round(float(lasso_pred[i]), 0),
            "gbm_pred": round(float(gbm_pred[i]), 0),
            "appreciation_pct": row["appreciation_pct"],
        })

    results = {
        "generated_from": {
            "panel_years": sorted(df["year"].unique().tolist()),
            "n_districts": int(df["district_id"].nunique()),
            "train_rows": len(train_df),
            "test_rows": len(test_df),
            "test_transition": f"{test_year} -> {test_year + 1}",
        },
        "feature_selection": {
            "candidates": ALL_CANDIDATE_FEATURES,
            "selected": selected_features,
            "history": selection_history,
        },
        "test_metrics": {
            "lasso": {k: round(v, 3) if k == "r2" else round(v, 1) for k, v in lasso_test_metrics.items()},
            "gbm": {k: round(v, 3) if k == "r2" else round(v, 1) for k, v in gbm_test_metrics.items()},
        },
        "lasso_coefficients": lasso_coefs,
        "gbm_feature_importances": gbm_importances,
        "predictions": predictions,
        "learning_curve_years": curve_years,
        "learning_curve_features": curve_features,
        "model_bakeoff": bakeoff,
    }

    OUT_FILE.write_text(json.dumps(results, indent=2))
    print(f"\n[OK] Wrote {OUT_FILE}")

    WEB_OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    WEB_OUT_FILE.write_text(json.dumps(results))
    print(f"[OK] Wrote {WEB_OUT_FILE}")


if __name__ == "__main__":
    main()
