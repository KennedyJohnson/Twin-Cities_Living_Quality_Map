"""
Export Census ACS housing affordability (median home value, median gross
rent, median household income, poverty rate) per district to
web/public/data/affordability_<city>.json.

Run: python export_affordability.py
"""

import sys
from pathlib import Path as _BootstrapPath
sys.path.insert(0, str(_BootstrapPath(__file__).resolve().parent.parent))


import json
import pandas as pd
from pathlib import Path
from cleaners.clean_housing_price import clean_housing_price, ACS_YEAR

PIPELINE_DIR = Path(__file__).resolve().parent.parent
OUT_DIR = PIPELINE_DIR.parent / "web" / "public" / "data"


def _rows_to_districts_json(df):
    return {
        str(int(row["district_id"])): {
            "median_home_value": None if pd.isna(row["median_home_value"]) else int(row["median_home_value"]),
            "median_gross_rent": None if pd.isna(row["median_gross_rent"]) else int(row["median_gross_rent"]),
            "median_household_income": None if pd.isna(row["median_household_income"]) else int(row["median_household_income"]),
            "poverty_rate": None if pd.isna(row["poverty_rate"]) else round(row["poverty_rate"], 1),
            "housing_cost_burden_rate": None if pd.isna(row["housing_cost_burden_rate"]) else round(row["housing_cost_burden_rate"], 1),
            "homeownership_rate": None if pd.isna(row["homeownership_rate"]) else round(row["homeownership_rate"], 1),
        }
        for _, row in df.iterrows()
    }


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for city in ["stpaul", "mpls"]:
        print(f"Exporting affordability data for {city}...")
        df = clean_housing_price(city=city)
        data = {"acs_year": ACS_YEAR, "districts": _rows_to_districts_json(df)}
        out_file = OUT_DIR / f"affordability_{city}.json"
        out_file.write_text(json.dumps(data, indent=2))
        print(f"[OK] Written {out_file} ({len(data['districts'])} districts)")

    # ZIP-level: the affordability *score* is already computed at zip
    # granularity (health_score.py's compute_affordability_index_zip), but
    # until now nothing exported the raw figures behind it, so the sidebar's
    # field-by-field breakdown panel showed "no affordability data" for a
    # ZIP selection even though its score was real. Mirrors
    # compute_affordability_index_zip's method exactly: a boundary zip
    # spanning both counties gets a row from each city's tract join, and
    # those are averaged together rather than one overwriting the other.
    print("Exporting affordability data for zip...")
    stpaul_zip_df = clean_housing_price(city="stpaul", granularity="zip")
    mpls_zip_df = clean_housing_price(city="mpls", granularity="zip")
    zip_df = pd.concat([stpaul_zip_df, mpls_zip_df], ignore_index=True)
    zip_df = zip_df.groupby("district_id", as_index=False).mean(numeric_only=True)
    zip_data = {"acs_year": ACS_YEAR, "districts": _rows_to_districts_json(zip_df)}
    zip_out_file = OUT_DIR / "affordability_zip.json"
    zip_out_file.write_text(json.dumps(zip_data, indent=2))
    print(f"[OK] Written {zip_out_file} ({len(zip_data['districts'])} zips)")


if __name__ == "__main__":
    main()
