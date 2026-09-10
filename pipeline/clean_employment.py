"""
Fetch unemployed labor-force counts (Census ACS 5-year estimates) by tract
and join to districts, as a labor-market-distress proxy for the Opportunity
component (more unemployment per capita = less opportunity).

Reuses the tract-centroid/API-key helpers already built for
clean_housing_price.py rather than duplicating them.
"""

import pandas as pd
from clean_housing_price import (
    ACS_YEAR,
    CITY_COUNTY,
    _acs_url,
    _load_census_api_key,
    _fetch_tract_centroids,
)
from load import load_boundaries
from shapely.geometry import Point, shape
import requests
from http_cache import cached_get

# Unemployed (in labor force) count
EMPLOYMENT_ACS_VARS = "B23025_005E"


def _fetch_unemployment_tracts(county_fips, year=ACS_YEAR):
    api_key = _load_census_api_key()
    if not api_key:
        raise RuntimeError("CENSUS_API_KEY not found in pipeline/.env or environment")

    params = {
        "get": EMPLOYMENT_ACS_VARS,
        "for": "tract:*",
        "in": f"state:27 county:{county_fips}",
        "key": api_key,
    }
    resp = cached_get(_acs_url(year), params=params, timeout=60)
    resp.raise_for_status()
    data = resp.json()
    header, rows = data[0], data[1:]
    df = pd.DataFrame(rows, columns=header)
    df["geoid"] = df["state"] + df["county"] + df["tract"]
    df["unemployed"] = pd.to_numeric(df["B23025_005E"], errors="coerce")
    df.loc[df["unemployed"] < 0, "unemployed"] = None
    return df[["geoid", "unemployed"]]


def clean_employment(city="stpaul", year=ACS_YEAR):
    """
    Fetch unemployed-person counts per tract and assign to districts via
    tract-centroid point-in-polygon, matching the aggregate_by_source
    count-based pattern (one row per tract/district, summed and divided by
    population downstream).

    Returns:
        DataFrame with columns: geoid, district_id, value (unemployed count)
    """
    county_fips = CITY_COUNTY[city]
    acs = _fetch_unemployment_tracts(county_fips, year=year)
    centroids = _fetch_tract_centroids(county_fips)
    tracts = acs.merge(centroids, on="geoid", how="inner")

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

    tracts["district_id"] = tracts.apply(find_district, axis=1)
    tracts = tracts.dropna(subset=["district_id", "unemployed"])
    tracts["district_id"] = tracts["district_id"].astype(int)
    tracts["value"] = tracts["unemployed"]

    return tracts[["geoid", "district_id", "value"]]


if __name__ == "__main__":
    for city in ["stpaul", "mpls"]:
        cleaned = clean_employment(city=city)
        print(f"[OK] Cleaned employment data for {city}: {len(cleaned)} tracts")
        totals = cleaned.groupby("district_id")["value"].sum()
        print(totals)
