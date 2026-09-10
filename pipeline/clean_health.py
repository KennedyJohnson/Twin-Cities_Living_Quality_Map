"""
Fetch tract-level chronic disease prevalence (obesity, diabetes) from the
CDC PLACES dataset (free, no API key required) and convert to an estimated
affected-resident count per district, as a Quality of Life health-outcomes
signal — more residents affected lowers Quality of Life.

Converting prevalence% to an estimated count (prevalence x tract
population) lets this plug into the same count-based aggregate_by_source()
pipeline as every other source (summed per district, then divided by total
district population downstream) instead of needing special-cased handling
like the Census ACS affordability metrics.

PLACES: https://data.cdc.gov/500-Cities-Places/PLACES-Local-Data-for-Better-Health-Census-Tract-/cwsq-ngmh
"""

import requests
from http_cache import cached_get
import pandas as pd
from pathlib import Path
from shapely.geometry import Point, shape
from load import load_boundaries

PIPELINE_DIR = Path(__file__).parent
PLACES_URL = "https://data.cdc.gov/resource/cwsq-ngmh.json"

# county name (as used by CDC PLACES' countyname field) per city
CITY_COUNTY_NAME = {
    "stpaul": "Ramsey",
    "mpls": "Hennepin",
}

MEASURES = ["OBESITY", "DIABETES"]


def _fetch_places_tracts(county_name, measure_id):
    params = {
        "stateabbr": "MN",
        "countyname": county_name,
        "measureid": measure_id,
        "$limit": 2000,
    }
    resp = cached_get(PLACES_URL, params=params, timeout=60)
    resp.raise_for_status()
    rows = resp.json()

    records = []
    for row in rows:
        geo = row.get("geolocation", {}).get("coordinates")
        value = row.get("data_value")
        population = row.get("totalpopulation")
        if not geo or value is None or population is None:
            continue
        try:
            records.append({
                "geoid": row.get("locationid"),
                "lon": float(geo[0]),
                "lat": float(geo[1]),
                "prevalence_pct": float(value),
                "population": float(population),
            })
        except (ValueError, TypeError):
            continue
    return pd.DataFrame(records)


def clean_health(fallback_behavior="exclude_from_scoring_if_geography_fails", city="stpaul"):
    """
    Fetch CDC PLACES obesity + diabetes prevalence per tract, convert each
    to an estimated affected-resident count, and join to districts via
    tract centroid point-in-polygon. city: 'stpaul' or 'mpls'.

    Returns:
        DataFrame with columns: geoid, district_id, value (estimated
        affected residents; aggregate_by_source() sums this per district)
    """
    county_name = CITY_COUNTY_NAME[city]

    try:
        measure_dfs = [_fetch_places_tracts(county_name, m) for m in MEASURES]
    except Exception as e:
        if fallback_behavior == "strict":
            raise
        print(f"[WARNING] CDC PLACES fetch failed ({e}); health will be excluded from scoring")
        return pd.DataFrame(columns=["geoid", "district_id", "value"])

    combined = pd.concat(measure_dfs, ignore_index=True)
    if combined.empty:
        if fallback_behavior == "strict":
            raise ValueError("No CDC PLACES data returned")
        return pd.DataFrame(columns=["geoid", "district_id", "value"])

    combined["affected_count"] = combined["prevalence_pct"] / 100 * combined["population"]

    boundaries = load_boundaries(city=city)
    boundary_map = {}
    for feature in boundaries["features"]:
        district_id = feature["properties"]["district_id"]
        boundary_map[district_id] = shape(feature["geometry"])

    def find_district(row):
        point = Point(row["lon"], row["lat"])
        for district_id, polygon in boundary_map.items():
            if polygon.contains(point):
                return district_id
        return None

    combined["district_id"] = combined.apply(find_district, axis=1)
    combined = combined.dropna(subset=["district_id"])
    combined["district_id"] = combined["district_id"].astype(int)
    combined["value"] = combined["affected_count"]

    health = combined[["geoid", "district_id", "value"]]

    if health.empty and fallback_behavior == "strict":
        raise ValueError("No CDC PLACES data could be joined to districts")

    return health


if __name__ == "__main__":
    for city in ["stpaul", "mpls"]:
        cleaned = clean_health(city=city)
        print(f"[OK] Cleaned health data for {city}: {len(cleaned)} tract/measure rows")
        totals = cleaned.groupby("district_id")["value"].sum().round(0)
        print(totals)
