"""
SHAP explainability for the Living Quality Score.

Which inputs actually move the score across the 28 districts? The composite
is a known formula, but its nominal weights don't answer that: a metric with
a 20% weight that barely varies between districts moves nothing, while one
that varies a lot dominates. SHAP measures realized influence instead.

For the total score and each of the 5 components, fit a linear surrogate
(Ridge on standardized, log-transformed inputs) and explain it with
shap.LinearExplainer. Each driver's importance is its mean |SHAP value| (score
points) across districts, also reported as a share of the total. The
surrogate's leave-one-out R^2 is reported so readers can see how faithfully it
reproduces the real score.

Standalone (not part of build.py): reads the already-exported district JSONs
in web/public/data/, writes results.json here and a copy to
web/public/data/score_drivers.json.

    python -m analysis.score_drivers.shap_drivers   (from pipeline/)
"""
import json
import shutil
from pathlib import Path

import numpy as np
import shap
from sklearn.linear_model import RidgeCV
from sklearn.model_selection import LeaveOneOut, cross_val_predict

ROOT = Path(__file__).resolve().parents[3]
DATA = ROOT / "web" / "public" / "data"
OUT = Path(__file__).resolve().parent / "results.json"

LABELS = {
    "crime_rate_pc": "Crime rate",
    "chronic_disease_pc": "Chronic disease",
    "crash_rate_pc": "Ped/bike crashes",
    "disaster_risk_pc": "Natural hazard risk",
    "permit_rate_pc": "Building permits",
    "unemployment_rate_pc": "Unemployment",
    "housing_inventory_pc": "For-sale listings",
    "education_score": "Bachelor's+ rate",
    "schools_pc": "Schools",
    "grocery_pc": "Groceries",
    "restaurants_pc": "Restaurants/bars",
    "entertainment_pc": "Entertainment venues",
    "healthcare_pc": "Healthcare",
    "broadband_score": "Broadband",
    "trail_km_pc": "Trails",
    "transit_stops_pc": "Transit stops",
    "traffic_vkm_pc": "Traffic volume",
    "walkability_score": "Walk/Bike Score",
    "commute_score": "Commute",
    "median_home_value": "Home value",
    "median_gross_rent": "Rent",
    "median_household_income": "Household income",
    "poverty_rate": "Poverty rate",
    "housing_cost_burden_rate": "Housing cost burden",
    "homeownership_rate": "Homeownership",
    "gini_index": "Income inequality (Gini)",
    "vacancy_rate": "Vacancy rate",
}

COMPONENTS = {
    "safety": ["crime_rate_pc", "chronic_disease_pc", "crash_rate_pc", "disaster_risk_pc"],
    "opportunity": ["permit_rate_pc", "unemployment_rate_pc", "housing_inventory_pc", "education_score"],
    "amenities": ["schools_pc", "grocery_pc", "restaurants_pc", "entertainment_pc",
                  "healthcare_pc", "broadband_score"],
    "transportation": ["trail_km_pc", "transit_stops_pc", "traffic_vkm_pc",
                       "walkability_score", "commute_score"],
    "affordability": ["median_home_value", "median_gross_rent", "median_household_income",
                      "poverty_rate", "housing_cost_burden_rate", "homeownership_rate",
                      "gini_index", "vacancy_rate"],
}
COMPONENT_OF = {f: c for c, fs in COMPONENTS.items() for f in fs}
# Per-capita counts are heavily right-skewed (downtowns); log them so one
# outlier district doesn't define the linear fit.
LOG_FEATURES = {f for f in COMPONENT_OF if f.endswith("_pc")}


def load_rows():
    rows = []
    for city, nb_file in (("stpaul", "neighborhoods.json"), ("mpls", "neighborhoods_mpls.json")):
        census = json.loads((DATA / f"affordability_{city}.json").read_text())["districts"]
        for d in json.loads((DATA / nb_file).read_text())["neighborhoods"]:
            row = {"district_id": d["district_id"], "name": d["district_name"],
                   "health_score": d["health_score"], **d["indices"]}
            row.update({k: m["rate_per_1000"] for k, m in d["metrics"].items()})
            row.update(census.get(str(d["district_id"]), {}))
            rows.append(row)
    return rows


def explain(rows, target, features):
    usable = [r for r in rows if r.get(target) is not None
              and all(r.get(f) is not None for f in features)]
    X = np.array([[np.log1p(r[f]) if f in LOG_FEATURES else r[f] for f in features]
                  for r in usable], dtype=float)
    X = (X - X.mean(0)) / np.where(X.std(0) > 0, X.std(0), 1)
    y = np.array([r[target] for r in usable], dtype=float)

    model = RidgeCV(alphas=np.logspace(-2, 2, 25)).fit(X, y)
    loo_pred = cross_val_predict(RidgeCV(alphas=np.logspace(-2, 2, 25)), X, y, cv=LeaveOneOut())
    loo_r2 = 1 - ((y - loo_pred) ** 2).sum() / ((y - y.mean()) ** 2).sum()

    sv = shap.LinearExplainer(model, X).shap_values(X)
    mean_abs = np.abs(sv).mean(0)
    drivers = sorted(
        ({"feature": f, "label": LABELS[f], "component": COMPONENT_OF[f],
          "mean_abs_shap": round(float(m), 2),
          "share_pct": round(float(100 * m / mean_abs.sum()), 1),
          # Sign of the fitted relationship: + means higher raw value -> higher score
          "direction": "+" if c >= 0 else "-"}
         for f, m, c in zip(features, mean_abs, model.coef_)),
        key=lambda d: -d["mean_abs_shap"])
    return {"n_districts": len(usable), "loo_r2": round(float(loo_r2), 3),
            "score_sd": round(float(y.std()), 2), "drivers": drivers}


def main():
    rows = load_rows()
    all_features = [f for fs in COMPONENTS.values() for f in fs]
    results = {"total": explain(rows, "health_score", all_features)}
    component_totals = {}
    for comp, feats in COMPONENTS.items():
        results[comp] = explain(rows, comp, feats)
        component_totals[comp] = sum(d["share_pct"] for d in results["total"]["drivers"]
                                     if d["component"] == comp)
    results["total"]["component_share_pct"] = {k: round(v, 1) for k, v in component_totals.items()}

    OUT.write_text(json.dumps(results, indent=2))
    shutil.copy(OUT, DATA / "score_drivers.json")
    for k, r in results.items():
        top = ", ".join(f"{d['label']} {d['share_pct']}%" for d in r["drivers"][:4])
        print(f"{k:15s} n={r['n_districts']} LOO R2={r['loo_r2']}: {top}")
    print("component shares of total:", results["total"]["component_share_pct"])


if __name__ == "__main__":
    main()
