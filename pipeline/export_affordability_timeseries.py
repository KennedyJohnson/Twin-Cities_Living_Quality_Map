"""
Export multi-year Census ACS median home value, gross rent, and household
income per district for trend charts on the frontend
(web/public/data/affordability_timeseries_<city>.json).

Fetches a handful of recent ACS 5-year vintages. Tract GEOIDs are mostly
stable across vintages but a few tracts can fail to join for years before
2020 (2010 Census vintage) — see clean_housing_price.py for details.

Run: python export_affordability_timeseries.py
"""

import json
from pathlib import Path

from clean_housing_price import clean_housing_price

PIPELINE_DIR = Path(__file__).parent
OUT_DIR = PIPELINE_DIR.parent / "web" / "public" / "data"

YEARS = [2018, 2019, 2020, 2021, 2022]


def export_city_timeseries(city):
    # by_year[year][district_id] = {field: value}
    by_year = {}
    years_included = []

    for year in YEARS:
        try:
            df = clean_housing_price(city=city, year=year)
        except Exception as e:
            print(f"  [WARNING] {city} {year} fetch failed ({e}); skipping")
            continue

        years_included.append(year)
        by_year[year] = {}
        for _, row in df.iterrows():
            district_id = str(int(row["district_id"]))
            by_year[year][district_id] = {
                "median_home_value": None if row["median_home_value"] is None else int(row["median_home_value"]),
                "median_gross_rent": None if row["median_gross_rent"] is None else int(row["median_gross_rent"]),
                "median_household_income": None if row["median_household_income"] is None else int(row["median_household_income"]),
                "poverty_rate": None if row["poverty_rate"] is None else round(row["poverty_rate"], 1),
                "housing_cost_burden_rate": None if row["housing_cost_burden_rate"] is None else round(row["housing_cost_burden_rate"], 1),
                "homeownership_rate": None if row["homeownership_rate"] is None else round(row["homeownership_rate"], 1),
            }

    all_district_ids = set()
    for year_data in by_year.values():
        all_district_ids.update(year_data.keys())

    per_district = {}
    for district_id in all_district_ids:
        per_district[district_id] = {
            "median_home_value": [by_year[y].get(district_id, {}).get("median_home_value") for y in years_included],
            "median_gross_rent": [by_year[y].get(district_id, {}).get("median_gross_rent") for y in years_included],
            "median_household_income": [by_year[y].get(district_id, {}).get("median_household_income") for y in years_included],
            "poverty_rate": [by_year[y].get(district_id, {}).get("poverty_rate") for y in years_included],
            "housing_cost_burden_rate": [by_year[y].get(district_id, {}).get("housing_cost_burden_rate") for y in years_included],
            "homeownership_rate": [by_year[y].get(district_id, {}).get("homeownership_rate") for y in years_included],
        }

    return {"years": years_included, "districts": per_district}


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for city in ["stpaul", "mpls"]:
        print(f"Exporting affordability time-series for {city}...")
        data = export_city_timeseries(city)
        out_file = OUT_DIR / f"affordability_timeseries_{city}.json"
        out_file.write_text(json.dumps(data))
        print(f"[OK] {len(data['years'])} years, {len(data['districts'])} districts")


if __name__ == "__main__":
    main()
