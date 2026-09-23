"""
Predict next-year median home value per district and compare model
families, using the district-year panel built by fetch_panel.py
(analysis/home_value_prediction/data/panel.csv, 2017-2024, 28 districts).

Framing:
- One row = one district-year "transition": features observed in year t
  predict median_home_value in year t+1 (a forward prediction, not a
  same-year correlation).
- Feature selection: greedy forward selection by leave-one-year-out (LOYO)
  CV RMSE on the years before the final transition.
- Model ranking: full LOYO bake-off -- every model is trained on 6 years and
  tested on the 7th, once per year, and ranked by mean RMSE across folds.
- Two sweeps (fixed final test year 2023 -> 2024): more training years vs.
  wider feature groups.

Elastic Net was tried and dropped: its CV picked l1_ratio=1 on every fold,
which makes it mathematically identical to Lasso here.

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

from sklearn.linear_model import LassoCV, Ridge, BayesianRidge
from sklearn.ensemble import GradientBoostingRegressor, RandomForestRegressor
from sklearn.svm import SVR
from sklearn.neighbors import KNeighborsRegressor
from sklearn.gaussian_process import GaussianProcessRegressor
from sklearn.gaussian_process.kernels import RBF, WhiteKernel, ConstantKernel
from sklearn.preprocessing import StandardScaler
from sklearn.compose import TransformedTargetRegressor
from sklearn.metrics import mean_squared_error, mean_absolute_error, r2_score

DATA_DIR = Path(__file__).resolve().parent / "data"
OUT_FILE = Path(__file__).resolve().parent / "results.json"
WEB_OUT_FILE = Path(__file__).resolve().parent.parent.parent.parent / "web" / "public" / "data" / "home_value_prediction.json"

TARGET = "median_home_value"

FEATURE_GROUPS = {
    # The 6 columns the site's own affordability trend charts expose.
    "core": [
        "median_gross_rent", "median_household_income", "poverty_rate",
        "housing_cost_burden_rate", "homeownership_rate", "unemployment_rate_pc",
    ],
    # This year's own home value. Omitting it (as an earlier version did)
    # forces every model to reconstruct price level from demographic
    # proxies; including it dropped Lasso's single-fold RMSE from $34,779
    # to ~$10,400. Home values are strongly autocorrelated year to year.
    "autoregressive": ["median_home_value"],
    "acs_extra": [
        "gini_index", "vacancy_rate", "broadband_rate", "bachelors_rate",
        "median_age", "avg_commute_min", "transit_commute_rate",
        "walk_commute_rate", "bike_commute_rate", "wfh_rate", "diversity_index",
    ],
}
FEATURE_GROUPS["core_plus_autoregressive"] = FEATURE_GROUPS["core"] + FEATURE_GROUPS["autoregressive"]
FEATURE_GROUPS["all"] = FEATURE_GROUPS["core"] + FEATURE_GROUPS["autoregressive"] + FEATURE_GROUPS["acs_extra"]
ALL_CANDIDATE_FEATURES = FEATURE_GROUPS["all"]

# name -> (needs_scaling, factory). Penalized-linear, kernel, and
# distance-based models need standardized inputs; tree ensembles don't.
MODEL_CANDIDATES = {
    "Lasso": (True, lambda: LassoCV(cv=5, max_iter=20000, random_state=0)),
    "Ridge": (True, lambda: Ridge(alpha=10.0, random_state=0)),
    # Target standardized: BayesianRidge's default priors assume a roughly
    # unit-scale target; on raw dollars with only 28-84 rows it over-shrinks
    # toward the mean (~$105K RMSE in the 1-3 year learning-curve points).
    "Bayesian Ridge": (True, lambda: TransformedTargetRegressor(regressor=BayesianRidge(), transformer=StandardScaler())),
    "Gaussian Process": (True, lambda: GaussianProcessRegressor(
        kernel=ConstantKernel(1.0) * RBF(length_scale=1.0) + WhiteKernel(noise_level=1.0),
        normalize_y=True, n_restarts_optimizer=3, random_state=0,
    )),
    "Random Forest": (False, lambda: RandomForestRegressor(n_estimators=200, max_depth=4, min_samples_leaf=2, random_state=0)),
    "Gradient Boosting": (False, lambda: GradientBoostingRegressor(n_estimators=80, max_depth=2, learning_rate=0.05, subsample=0.8, random_state=0)),
    "K-Nearest Neighbors": (True, lambda: KNeighborsRegressor(n_neighbors=5, weights="distance")),
    "Support Vector (RBF)": (True, lambda: SVR(kernel="rbf", C=1e5, epsilon=1000)),
}

# Models shown in the per-fold / learning-curve / per-district views: the
# top 3 from the bake-off plus Gradient Boosting as the tree-ensemble
# contrast. Chosen from the bake-off ranking at runtime (see main()).
N_TOP = 3
CONTRAST_MODEL = "Gradient Boosting"


def load_transitions():
    """One row per (city, district_id, year_t): year_t features plus
    year_(t+1) median_home_value as `label`."""
    panel = pd.read_csv(DATA_DIR / "panel.csv").sort_values(["city", "district_id", "year"])
    rows = []
    for (city, district_id), group in panel.groupby(["city", "district_id"]):
        group = group.set_index("year")
        years = sorted(group.index)
        for y in years:
            if y + 1 not in years:
                continue
            row = {"city": city, "district_id": district_id, "year": y}
            for col in ALL_CANDIDATE_FEATURES:
                row[col] = group.loc[y, col]
            row["label"] = group.loc[y + 1, TARGET]
            rows.append(row)
    return pd.DataFrame(rows)


def rmse(y_true, y_pred):
    return float(np.sqrt(mean_squared_error(y_true, y_pred)))


def fit_predict(name, train, test, features):
    needs_scaling, factory = MODEL_CANDIDATES[name]
    if needs_scaling:
        scaler = StandardScaler()
        X_train, X_test = scaler.fit_transform(train[features]), scaler.transform(test[features])
    else:
        X_train, X_test = train[features], test[features]
    model = factory()
    model.fit(X_train, train["label"])
    return model.predict(X_test)


def loyo_cv_error(df, features, name="Lasso"):
    """Mean RMSE across leave-one-year-out folds within df."""
    fold_rmses = []
    for y in sorted(df["year"].unique()):
        train, val = df[df["year"] != y], df[df["year"] == y]
        if val.empty or train.empty:
            continue
        fold_rmses.append(rmse(val["label"], fit_predict(name, train, val, features)))
    return float(np.mean(fold_rmses)) if fold_rmses else None


def forward_select_features(train_df, candidates):
    """Greedy forward selection: add whichever remaining feature most
    improves Lasso's LOYO CV RMSE; stop when nothing improves it."""
    selected, remaining = [], list(candidates)
    best = float(np.sqrt(np.mean((train_df["label"] - train_df["label"].mean()) ** 2)))
    history = [{"step": 0, "added": None, "features": [], "cv_rmse": round(best, 1)}]
    while remaining:
        scored = sorted((loyo_cv_error(train_df, selected + [f]), f) for f in remaining)
        err, feat = scored[0]
        if err >= best - 1e-6:
            break
        selected.append(feat)
        remaining.remove(feat)
        best = err
        history.append({"step": len(selected), "added": feat, "features": list(selected), "cv_rmse": round(best, 1)})
    return selected, history


# Kept for pipeline/tests/test_home_value_prediction.py.
def fit_final_lasso(train_df, features):
    scaler = StandardScaler()
    model = LassoCV(cv=5, max_iter=20000, random_state=0)
    model.fit(scaler.fit_transform(train_df[features]), train_df["label"])
    return model, scaler


def evaluate(model, scaler, df, features, is_lasso):
    X = scaler.transform(df[features]) if is_lasso else df[features]
    pred = model.predict(X)
    return {
        "rmse": rmse(df["label"], pred),
        "mae": float(mean_absolute_error(df["label"], pred)),
        "r2": float(r2_score(df["label"], pred)),
    }, pred


def run_model_bakeoff(df, features):
    """Every model, trained on 6 years and tested on the 7th, for all 7
    years; ranked by mean RMSE across folds."""
    results = []
    years = sorted(df["year"].unique())
    for name in MODEL_CANDIDATES:
        folds, all_true, all_pred, all_city = [], [], [], []
        for y in years:
            train, test = df[df["year"] != y], df[df["year"] == y]
            pred = fit_predict(name, train, test, features)
            folds.append({"test_year": int(y), "rmse": round(rmse(test["label"], pred), 1)})
            all_true.extend(test["label"]); all_pred.extend(pred); all_city.extend(test["city"])
        fold_rmses = [f["rmse"] for f in folds]
        # Per-city accuracy pooled over all 7 held-out folds. MAPE is the
        # headline since the two cities sit at different price levels.
        t, p_, c = np.array(all_true), np.array(all_pred), np.array(all_city)
        by_city = {
            city: {
                "rmse": round(rmse(t[c == city], p_[c == city]), 1),
                "mape": round(float(np.mean(np.abs(p_[c == city] - t[c == city]) / t[c == city]) * 100), 2),
                "n": int((c == city).sum()),
            }
            for city in sorted(set(all_city))
        }
        results.append({
            "model": name,
            "mean_rmse": round(float(np.mean(fold_rmses)), 1),
            "std_rmse": round(float(np.std(fold_rmses)), 1),
            "pooled_r2": round(float(r2_score(all_true, all_pred)), 3),
            "by_city": by_city,
            "folds": folds,
        })
    results.sort(key=lambda r: r["mean_rmse"])
    return results


def learning_curve_years(train_df, test_df, features, models):
    """Train on the most recent N years, N = 1..all; fixed test year."""
    years = sorted(train_df["year"].unique())
    curve = []
    for n in range(1, len(years) + 1):
        sub = train_df[train_df["year"].isin(years[-n:])]
        point = {"n_training_years": n, "training_rows": len(sub)}
        for name in models:
            point[name] = round(rmse(test_df["label"], fit_predict(name, sub, test_df, features)), 1)
        curve.append(point)
    return curve


def learning_curve_features(train_df, test_df, selected, models):
    """Train on increasingly wide feature groups; fixed years and test year."""
    groups = [
        ("core", FEATURE_GROUPS["core"]),
        ("core_plus_autoregressive", FEATURE_GROUPS["core_plus_autoregressive"]),
        ("all", FEATURE_GROUPS["all"]),
        ("forward_selected", selected),
    ]
    curve = []
    for group_name, features in groups:
        point = {"feature_group": group_name, "n_features": len(features)}
        for name in models:
            point[name] = round(rmse(test_df["label"], fit_predict(name, train_df, test_df, features)), 1)
        curve.append(point)
    return curve


def main():
    df = load_transitions()
    test_year = int(df["year"].max())
    train_df = df[df["year"] < test_year].reset_index(drop=True)
    test_df = df[df["year"] == test_year].reset_index(drop=True)
    print(f"Train: {len(train_df)} rows, test: {len(test_df)} rows ({test_year} -> {test_year + 1})")

    selected, history = forward_select_features(train_df, ALL_CANDIDATE_FEATURES)
    print(f"Selected: {selected}")

    bakeoff = run_model_bakeoff(df, selected)
    for r in bakeoff:
        print(f"  {r['model']:<22} mean RMSE ${r['mean_rmse']:>9,.0f} (+/- ${r['std_rmse']:,.0f})  R2 {r['pooled_r2']:.3f}")

    top = [r["model"] for r in bakeoff[:N_TOP]]
    featured = top + ([CONTRAST_MODEL] if CONTRAST_MODEL not in top else [])

    preds = {name: fit_predict(name, train_df, test_df, selected) for name in featured}
    test_metrics = {
        name: {
            "rmse": round(rmse(test_df["label"], p), 1),
            "r2": round(float(r2_score(test_df["label"], p)), 3),
        }
        for name, p in preds.items()
    }
    predictions = [
        {
            "city": row["city"],
            "district_id": int(row["district_id"]),
            "actual": round(float(row["label"])),
            "preds": {name: round(float(preds[name][i])) for name in featured},
        }
        for i, row in test_df.iterrows()
    ]

    results = {
        "generated_from": {
            "panel_years": sorted(int(y) for y in df["year"].unique()),
            "n_districts": int(df["district_id"].nunique()),
            "n_transitions": len(df),
            "test_transition": f"{test_year} -> {test_year + 1}",
        },
        "feature_selection": {"candidates": ALL_CANDIDATE_FEATURES, "selected": selected, "history": history},
        "top_models": top,
        "featured_models": featured,
        "model_bakeoff": bakeoff,
        "test_metrics": test_metrics,
        "predictions": predictions,
        "learning_curve_years": learning_curve_years(train_df, test_df, selected, featured),
        "learning_curve_features": learning_curve_features(train_df, test_df, selected, featured),
    }

    OUT_FILE.write_text(json.dumps(results, indent=2))
    WEB_OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    WEB_OUT_FILE.write_text(json.dumps(results))
    print(f"[OK] Wrote {OUT_FILE} and {WEB_OUT_FILE}")


if __name__ == "__main__":
    main()
