"""
Export Census ACS housing affordability (median home value, median gross
rent) per district to web/public/data/affordability_<city>.json.

Run: python export_affordability.py
"""

import json
from pathlib import Path
from clean_housing_price import clean_housing_price

PIPELINE_DIR = Path(__file__).parent
OUT_DIR = PIPELINE_DIR.parent / "web" / "public" / "data"


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for city in ["stpaul", "mpls"]:
        print(f"Exporting affordability data for {city}...")
        df = clean_housing_price(city=city)
        data = {
            str(int(row["district_id"])): {
                "median_home_value": None if row["median_home_value"] is None else int(row["median_home_value"]),
                "median_gross_rent": None if row["median_gross_rent"] is None else int(row["median_gross_rent"]),
            }
            for _, row in df.iterrows()
        }
        out_file = OUT_DIR / f"affordability_{city}.json"
        out_file.write_text(json.dumps(data, indent=2))
        print(f"[OK] Written {out_file} ({len(data)} districts)")


if __name__ == "__main__":
    main()
