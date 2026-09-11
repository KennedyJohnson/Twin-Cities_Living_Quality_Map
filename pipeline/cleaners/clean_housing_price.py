"""
Fetch median home value and median gross rent (Census ACS 5-year estimates)
by Census tract, join tracts to project districts via tract centroid
point-in-polygon against the district boundaries, and average up to district
level. Used to show housing affordability on the map/sidebar for both cities.

Requires a free Census API key (https://api.census.gov/data/key_signup.html)
set as CENSUS_API_KEY in pipeline/.env (gitignored).
"""

import sys
from pathlib import Path as _BootstrapPath
sys.path.insert(0, str(_BootstrapPath(__file__).resolve().parent.parent))


import os
import requests
from core.http_cache import cached_get
import pandas as pd
from pathlib import Path
from shapely.geometry import Point, shape
from core.load import load_boundaries

PIPELINE_DIR = Path(__file__).resolve().parent.parent
ACS_YEAR = 2022


def _acs_url(year):
    return f"https://api.census.gov/data/{year}/acs/acs5"

# Median home value, median gross rent, median household income, total
# population, poverty universe + count below poverty line, renter
# households by gross-rent-as-%-of-income bracket (30-34.9, 35-39.9,
# 40-49.9, 50+ = cost-burdened) + total renter households (universe), and
# occupied housing units by tenure (total + owner-occupied)
ACS_VARS = (
    "B25077_001E,B25064_001E,B19013_001E,B01003_001E,"
    "B17001_001E,B17001_002E,"
    "B25070_001E,B25070_007E,B25070_008E,B25070_009E,B25070_010E,"
    "B25003_001E,B25003_002E"
)

# state=MN (27); county FIPS per city
CITY_COUNTY = {
    "stpaul": "123",  # Ramsey County
    "mpls": "053",    # Hennepin County
}

TIGERWEB_URL = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer/8/query"


def _load_census_api_key():
    env_file = PIPELINE_DIR / ".env"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if line.startswith("CENSUS_API_KEY="):
                return line.split("=", 1)[1].strip()
    return os.environ.get("CENSUS_API_KEY")


def _fetch_acs_tracts(county_fips, year=ACS_YEAR):
    api_key = _load_census_api_key()
    if not api_key:
        raise RuntimeError("CENSUS_API_KEY not found in pipeline/.env or environment")

    params = {
        "get": ACS_VARS,
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
    df["median_home_value"] = pd.to_numeric(df["B25077_001E"], errors="coerce")
    df["median_gross_rent"] = pd.to_numeric(df["B25064_001E"], errors="coerce")
    df["median_household_income"] = pd.to_numeric(df["B19013_001E"], errors="coerce")
    df["population"] = pd.to_numeric(df["B01003_001E"], errors="coerce")
    poverty_universe = pd.to_numeric(df["B17001_001E"], errors="coerce")
    poverty_count = pd.to_numeric(df["B17001_002E"], errors="coerce")
    df["poverty_rate"] = (poverty_count / poverty_universe * 100).where(poverty_universe > 0)

    renter_universe = pd.to_numeric(df["B25070_001E"], errors="coerce")
    cost_burdened_count = sum(
        pd.to_numeric(df[col], errors="coerce")
        for col in ["B25070_007E", "B25070_008E", "B25070_009E", "B25070_010E"]
    )
    df["housing_cost_burden_rate"] = (cost_burdened_count / renter_universe * 100).where(renter_universe > 0)

    tenure_universe = pd.to_numeric(df["B25003_001E"], errors="coerce")
    owner_occupied = pd.to_numeric(df["B25003_002E"], errors="coerce")
    df["homeownership_rate"] = (owner_occupied / tenure_universe * 100).where(tenure_universe > 0)

    # Census codes negative sentinel values (e.g. -666666666) for unavailable estimates
    df.loc[df["median_home_value"] < 0, "median_home_value"] = None
    df.loc[df["median_gross_rent"] < 0, "median_gross_rent"] = None
    df.loc[df["median_household_income"] < 0, "median_household_income"] = None
    df.loc[poverty_count < 0, "poverty_rate"] = None
    df.loc[cost_burdened_count < 0, "housing_cost_burden_rate"] = None
    df.loc[owner_occupied < 0, "homeownership_rate"] = None
    return df[[
        "geoid", "median_home_value", "median_gross_rent", "median_household_income",
        "poverty_rate", "housing_cost_burden_rate", "homeownership_rate", "population",
    ]]


def _fetch_tract_centroids(county_fips):
    params = {
        "where": f"STATE='27' AND COUNTY='{county_fips}'",
        "outFields": "GEOID,CENTLAT,CENTLON",
        "returnGeometry": "false",
        "f": "json",
    }
    resp = cached_get(TIGERWEB_URL, params=params, timeout=60)
    resp.raise_for_status()
    data = resp.json()
    rows = []
    for f in data.get("features", []):
        attrs = f["attributes"]
        rows.append({
            "geoid": attrs["GEOID"],
            "lat": float(attrs["CENTLAT"]),
            "lon": float(attrs["CENTLON"]),
        })
    return pd.DataFrame(rows)


def clean_housing_price_tracts(city="stpaul", year=ACS_YEAR):
    """
    Fetch ACS median home value / gross rent per tract, joined to tract
    centroids, WITHOUT aggregating up to district level. Used for radius
    (arbitrary point-in-circle) affordability queries, where district
    boundaries aren't the right join target.

    Returns:
        DataFrame with columns: geoid, lat, lon, population,
        median_home_value, median_gross_rent, median_household_income,
        poverty_rate, housing_cost_burden_rate, homeownership_rate
    """
    county_fips = CITY_COUNTY[city]
    acs = _fetch_acs_tracts(county_fips, year=year)
    centroids = _fetch_tract_centroids(county_fips)
    tracts = acs.merge(centroids, on="geoid", how="inner")
    return tracts[[
        "geoid", "lat", "lon", "population", "median_home_value", "median_gross_rent",
        "median_household_income", "poverty_rate", "housing_cost_burden_rate", "homeownership_rate",
    ]]


def clean_housing_price(city="stpaul", year=ACS_YEAR):
    """
    Fetch ACS median home value / gross rent per tract and aggregate to
    district level (population-weighted mean) via tract-centroid spatial join.

    Note on tract vintage: TIGERweb's "current" tract boundaries are 2020
    Census vintage. ACS years >= 2020 match that vintage; earlier years use
    2010-vintage tract GEOIDs, which are mostly but not always identical —
    a handful of tracts may fail to join for years before 2020.

    Returns:
        DataFrame with columns: district_id, median_home_value, median_gross_rent, median_household_income
    """
    tracts = clean_housing_price_tracts(city=city, year=year)

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

    tracts = tracts.copy()
    tracts["district_id"] = tracts.apply(find_district, axis=1)
    tracts = tracts.dropna(subset=["district_id"])
    tracts["district_id"] = tracts["district_id"].astype(int)

    def weighted_mean(group, col):
        valid = group.dropna(subset=[col, "population"])
        valid = valid[valid["population"] > 0]
        if valid.empty:
            return None
        return round((valid[col] * valid["population"]).sum() / valid["population"].sum(), 0)

    rows = []
    for district_id, group in tracts.groupby("district_id"):
        rows.append({
            "district_id": district_id,
            "median_home_value": weighted_mean(group, "median_home_value"),
            "median_gross_rent": weighted_mean(group, "median_gross_rent"),
            "median_household_income": weighted_mean(group, "median_household_income"),
            "poverty_rate": weighted_mean(group, "poverty_rate"),
            "housing_cost_burden_rate": weighted_mean(group, "housing_cost_burden_rate"),
            "homeownership_rate": weighted_mean(group, "homeownership_rate"),
        })

    return pd.DataFrame(rows, columns=[
        "district_id", "median_home_value", "median_gross_rent", "median_household_income",
        "poverty_rate", "housing_cost_burden_rate", "homeownership_rate",
    ])


if __name__ == "__main__":
    for city in ["stpaul", "mpls"]:
        print(f"Fetching housing price/rent data for {city}...")
        result = clean_housing_price(city=city)
        print(result.to_string(index=False))
        print()
