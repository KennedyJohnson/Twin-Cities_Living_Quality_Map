"""
Build a district-year panel for the home value prediction analysis.

Reuses cleaners.clean_housing_price (the same ACS loader the map's
affordability figures come from) across YEARS, one call per (city, year).
2017 is the earliest year all ACS variables this analysis uses are
published under stable variable codes (B28002 broadband first appears in
the 2017 5-year vintage; the analysis needs the full feature set, so
earlier years are skipped rather than fetched with a partial one). This
gives an 8-year panel (2017-2024) vs. the 5 years (2018-2022) the frontend
trend charts use, which is the point: more training rows for the model
comparison than the site's existing timeseries exports have.

Output: analysis/home_value_prediction/data/panel.csv, one row per
(city, district_id, year), committed to the repo (~230 rows, a few KB) so
train.py can run without a Census API key.

Run: python fetch_panel.py
"""

import sys
from pathlib import Path as _BootstrapPath
sys.path.insert(0, str(_BootstrapPath(__file__).resolve().parent.parent.parent))

import pandas as pd
from pathlib import Path

from cleaners.clean_housing_price import clean_housing_price

OUT_DIR = Path(__file__).resolve().parent / "data"
YEARS = list(range(2017, 2025))  # 2017-2024 inclusive
CITIES = ["stpaul", "mpls"]

FEATURE_COLS = [
    "median_home_value", "median_gross_rent", "median_household_income",
    "poverty_rate", "housing_cost_burden_rate", "homeownership_rate",
    "broadband_rate", "unemployment_rate_pc", "gini_index", "vacancy_rate",
    "bachelors_rate", "median_age", "avg_commute_min",
    "transit_commute_rate", "walk_commute_rate", "bike_commute_rate",
    "wfh_rate", "diversity_index",
]


def build_panel():
    rows = []
    for city in CITIES:
        for year in YEARS:
            print(f"Fetching {city} {year}...")
            try:
                df = clean_housing_price(city=city, year=year, granularity="district")
            except Exception as e:
                print(f"  [WARNING] {city} {year} failed ({e}); skipping")
                continue
            df = df.copy()
            df["city"] = city
            df["year"] = year
            rows.append(df[["city", "district_id", "year"] + FEATURE_COLS])
    panel = pd.concat(rows, ignore_index=True)
    panel = panel.sort_values(["city", "district_id", "year"]).reset_index(drop=True)
    return panel


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    panel = build_panel()
    out_file = OUT_DIR / "panel.csv"
    panel.to_csv(out_file, index=False)
    print(f"[OK] {len(panel)} district-year rows -> {out_file}")
    print(f"Districts: {panel['district_id'].nunique()}, Years: {sorted(panel['year'].unique())}")


if __name__ == "__main__":
    main()
