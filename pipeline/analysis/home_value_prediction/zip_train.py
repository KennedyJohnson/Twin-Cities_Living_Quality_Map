"""
ZIP-level home value forecast on Zillow ZHVI (data/zhvi_zip.csv, built by
fetch_zhvi.py): every ZIP grows at the mean historical year-over-year rate
("Average growth"). Error is reported leave-one-year-out (LOYO) and
forward-chaining (train on past years only).

Note: a Lasso model on own value, prior-year growth, and relative price was
tried and removed. It beat this baseline under LOYO but had worse error
under forward-chaining ($16.4K vs. $15.2K mean RMSE), the honest test for a
forecast, so it was dropped.

Output: results_zip.json. Run: python zip_train.py
"""
import sys
from pathlib import Path as _P
sys.path.insert(0, str(_P(__file__).resolve().parent.parent.parent))

import json
import warnings
import numpy as np
import pandas as pd
from pathlib import Path

import train as T

warnings.filterwarnings("ignore")
HERE = Path(__file__).resolve().parent


def load_zip_transitions():
    p = pd.read_csv(HERE / "data" / "zhvi_zip.csv", dtype={"zip": str})
    p = p.dropna(subset=[f"zhvi_{y}" for y in range(2016, 2026)])
    rows = [{"city": r["county"], "district_id": r["zip"], "year": y,
             "median_home_value": r[f"zhvi_{y}"], "label": r[f"zhvi_{y + 1}"]}
            for _, r in p.iterrows() for y in range(2017, 2025)]
    return pd.DataFrame(rows)


def forward_chaining(df, predict, first_test_year=2019):
    folds = []
    for y in sorted(df["year"].unique()):
        if y < first_test_year:
            continue
        tr, te = df[df["year"] < y], df[df["year"] == y]
        folds.append({"test_year": int(y), "rmse": round(T.rmse(te["label"], predict(tr, te)), 1)})
    return {"mean_rmse": round(float(np.mean([f["rmse"] for f in folds])), 1), "folds": folds}


def main():
    d = load_zip_transitions()
    growth = float((d["label"] / d["median_home_value"]).mean())
    latest = pd.read_csv(HERE / "data" / "zhvi_zip.csv", dtype={"zip": str}).dropna(subset=["zhvi_2025"])
    out = {
        "method": "Average growth",
        "n_zips": int(d["district_id"].nunique()), "n_rows": len(d),
        "loyo": T.loyo_summary(d, T.naive_avg_growth),
        "forward_chaining": forward_chaining(d, T.naive_avg_growth),
        "mean_growth_ratio": round(growth, 4),
        "forecast_2026": {z: round(v * growth) for z, v in zip(latest["zip"], latest["zhvi_2025"])},
        "note": "A Lasso model was removed: worse forward-chaining error ($16.4K vs. $15.2K mean RMSE).",
    }
    (HERE / "results_zip.json").write_text(json.dumps(out, indent=2))
    print("loyo", out["loyo"]["mean_rmse"], "forward_chaining", out["forward_chaining"]["mean_rmse"])


if __name__ == "__main__":
    main()
