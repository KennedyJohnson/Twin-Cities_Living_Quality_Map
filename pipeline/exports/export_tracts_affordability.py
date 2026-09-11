"""
Export Census tract-level affordability rows (centroid + fields, no district
rollup) so the frontend can compute an affordability figure for an arbitrary
1-mile radius by averaging whichever tracts fall inside it, population-weighted
— the same weighting `clean_housing_price.py` uses to roll tracts up to
districts, just against a circle instead of a district polygon.

Writes web/public/data/tracts_affordability_{city}.json.

Run: python export_tracts_affordability.py
"""

import sys
from pathlib import Path as _BootstrapPath
sys.path.insert(0, str(_BootstrapPath(__file__).resolve().parent.parent))


import json
import math
from pathlib import Path

from cleaners.clean_housing_price import clean_housing_price_tracts, ACS_YEAR

PIPELINE_DIR = Path(__file__).resolve().parent.parent
OUT_DIR = PIPELINE_DIR.parent / "web" / "public" / "data"

FIELDS = [
    "median_home_value", "median_gross_rent", "median_household_income",
    "poverty_rate", "housing_cost_burden_rate", "homeownership_rate",
]


def _clean(value):
    if value is None:
        return None
    try:
        if isinstance(value, float) and math.isnan(value):
            return None
    except TypeError:
        pass
    return value


def _export_city(city):
    df = clean_housing_price_tracts(city=city)
    tracts = []
    for _, row in df.iterrows():
        if row.get("lat") is None or row.get("lon") is None:
            continue
        entry = {
            "tract_id": row["geoid"],
            "lat": float(row["lat"]),
            "lon": float(row["lon"]),
            "population": _clean(row.get("population")),
        }
        for field in FIELDS:
            entry[field] = _clean(row.get(field))
        tracts.append(entry)
    return {"acs_year": ACS_YEAR, "tracts": tracts}


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for city in ["stpaul", "mpls"]:
        print(f"Exporting {city} tract affordability...")
        try:
            data = _export_city(city)
        except Exception as e:
            print(f"[WARNING] Tract affordability export failed for {city}: {e}")
            continue
        (OUT_DIR / f"tracts_affordability_{city}.json").write_text(json.dumps(data))
        print(f"[OK] {len(data['tracts'])} {city} tracts")


if __name__ == "__main__":
    main()
