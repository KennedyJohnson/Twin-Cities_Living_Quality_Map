"""
Export Census tract-level affordability AND safety rows (centroid + fields,
no district rollup) so the frontend can compute a figure for an arbitrary
1-mile radius by averaging whichever tracts fall inside it, population-weighted
— the same weighting `clean_housing_price.py` uses to roll tracts up to
districts, just against a circle instead of a district polygon.

Chronic disease burden (CDC PLACES) and natural hazard risk (FEMA NRI) are
tract-level sources too (like the Census affordability fields), not
point/line geometry — a district's Safety score already blends them in
alongside crime/crashes (see config/sources.json), but a 1-mile radius
"place" score previously couldn't, since neither had a client-side export.
Bundled into this same tract file (joined by geoid) rather than a separate
export, since the frontend already loads and radius-filters one tract file.

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
from cleaners.clean_health import _fetch_places_tracts, CITY_COUNTY_NAME as HEALTH_COUNTY_NAME, MEASURES
from cleaners.clean_disaster_risk import _fetch_nri_tracts, CITY_COUNTY_NAME as RISK_COUNTY_NAME

PIPELINE_DIR = Path(__file__).resolve().parent.parent
OUT_DIR = PIPELINE_DIR.parent / "web" / "public" / "data"

FIELDS = [
    "median_home_value", "median_gross_rent", "median_household_income",
    "poverty_rate", "housing_cost_burden_rate", "homeownership_rate",
]


def _chronic_disease_by_geoid(city):
    """{geoid: combined obesity+diabetes prevalence %}, matching how
    clean_health.py sums both measures' affected-count before dividing by
    population for the district-level metric."""
    county_name = HEALTH_COUNTY_NAME[city]
    totals = {}
    for measure in MEASURES:
        df = _fetch_places_tracts(county_name, measure)
        for _, row in df.iterrows():
            totals[row["geoid"]] = totals.get(row["geoid"], 0.0) + row["prevalence_pct"]
    return totals


def _disaster_risk_by_geoid(city):
    """{geoid: FEMA NRI composite RISK_SCORE (0-100)}."""
    county_name = RISK_COUNTY_NAME[city]
    df = _fetch_nri_tracts(county_name)
    return dict(zip(df["geoid"], df["risk_score"])) if not df.empty else {}


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

    try:
        chronic_disease = _chronic_disease_by_geoid(city)
    except Exception as e:
        print(f"[WARNING] Chronic disease tract fetch failed for {city}: {e}")
        chronic_disease = {}

    try:
        disaster_risk = _disaster_risk_by_geoid(city)
    except Exception as e:
        print(f"[WARNING] Disaster risk tract fetch failed for {city}: {e}")
        disaster_risk = {}

    tracts = []
    for _, row in df.iterrows():
        if row.get("lat") is None or row.get("lon") is None:
            continue
        geoid = row["geoid"]
        entry = {
            "tract_id": geoid,
            "lat": float(row["lat"]),
            "lon": float(row["lon"]),
            "population": _clean(row.get("population")),
        }
        for field in FIELDS:
            entry[field] = _clean(row.get(field))
        entry["chronic_disease_prevalence"] = _clean(chronic_disease.get(geoid))
        entry["disaster_risk_score"] = _clean(disaster_risk.get(geoid))
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
