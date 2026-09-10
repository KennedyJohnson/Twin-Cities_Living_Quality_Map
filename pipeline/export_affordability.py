"""
Export Census ACS housing affordability (median home value, median gross
rent, median household income, poverty rate) per district to
web/public/data/affordability_<city>.json.

Run: python export_affordability.py
"""

import json
from pathlib import Path
from clean_housing_price import clean_housing_price, ACS_YEAR

PIPELINE_DIR = Path(__file__).parent
OUT_DIR = PIPELINE_DIR.parent / "web" / "public" / "data"


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for city in ["stpaul", "mpls"]:
        print(f"Exporting affordability data for {city}...")
        df = clean_housing_price(city=city)
        data = {
            "acs_year": ACS_YEAR,
            "districts": {
                str(int(row["district_id"])): {
                    "median_home_value": None if row["median_home_value"] is None else int(row["median_home_value"]),
                    "median_gross_rent": None if row["median_gross_rent"] is None else int(row["median_gross_rent"]),
                    "median_household_income": None if row["median_household_income"] is None else int(row["median_household_income"]),
                    "poverty_rate": None if row["poverty_rate"] is None else round(row["poverty_rate"], 1),
                    "housing_cost_burden_rate": None if row["housing_cost_burden_rate"] is None else round(row["housing_cost_burden_rate"], 1),
                    "homeownership_rate": None if row["homeownership_rate"] is None else round(row["homeownership_rate"], 1),
                }
                for _, row in df.iterrows()
            },
        }
        out_file = OUT_DIR / f"affordability_{city}.json"
        out_file.write_text(json.dumps(data, indent=2))
        print(f"[OK] Written {out_file} ({len(data['districts'])} districts)")


if __name__ == "__main__":
    main()
