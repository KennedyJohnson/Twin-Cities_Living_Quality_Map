"""
Fetch median home value and median gross rent (Census ACS 5-year estimates)
by Census tract, join tracts to project districts via tract centroid
point-in-polygon against the district boundaries, and average up to district
level. Used to show housing affordability on the map/sidebar for both cities.

Requires a free Census API key (https://api.census.gov/data/key_signup.html)
set as CENSUS_API_KEY in pipeline/.env (gitignored).
"""

import os
import requests
import pandas as pd
from pathlib import Path
from shapely.geometry import Point, shape
from load import load_boundaries

PIPELINE_DIR = Path(__file__).parent
ACS_YEAR = 2022
ACS_URL = f"https://api.census.gov/data/{ACS_YEAR}/acs/acs5"

# Median home value, median gross rent, total population
ACS_VARS = "B25077_001E,B25064_001E,B01003_001E"

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


def _fetch_acs_tracts(county_fips):
    api_key = _load_census_api_key()
    if not api_key:
        raise RuntimeError("CENSUS_API_KEY not found in pipeline/.env or environment")

    params = {
        "get": ACS_VARS,
        "for": "tract:*",
        "in": f"state:27 county:{county_fips}",
        "key": api_key,
    }
    resp = requests.get(ACS_URL, params=params, timeout=60)
    resp.raise_for_status()
    data = resp.json()
    header, rows = data[0], data[1:]
    df = pd.DataFrame(rows, columns=header)
    df["geoid"] = df["state"] + df["county"] + df["tract"]
    df["median_home_value"] = pd.to_numeric(df["B25077_001E"], errors="coerce")
    df["median_gross_rent"] = pd.to_numeric(df["B25064_001E"], errors="coerce")
    df["population"] = pd.to_numeric(df["B01003_001E"], errors="coerce")
    # Census codes negative sentinel values (e.g. -666666666) for unavailable estimates
    df.loc[df["median_home_value"] < 0, "median_home_value"] = None
    df.loc[df["median_gross_rent"] < 0, "median_gross_rent"] = None
    return df[["geoid", "median_home_value", "median_gross_rent", "population"]]


def _fetch_tract_centroids(county_fips):
    params = {
        "where": f"STATE='27' AND COUNTY='{county_fips}'",
        "outFields": "GEOID,CENTLAT,CENTLON",
        "returnGeometry": "false",
        "f": "json",
    }
    resp = requests.get(TIGERWEB_URL, params=params, timeout=60)
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


def clean_housing_price(city="stpaul"):
    """
    Fetch ACS median home value / gross rent per tract and aggregate to
    district level (population-weighted mean) via tract-centroid spatial join.

    Returns:
        DataFrame with columns: district_id, median_home_value, median_gross_rent
    """
    county_fips = CITY_COUNTY[city]
    acs = _fetch_acs_tracts(county_fips)
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
        })

    return pd.DataFrame(rows, columns=["district_id", "median_home_value", "median_gross_rent"])


if __name__ == "__main__":
    for city in ["stpaul", "mpls"]:
        print(f"Fetching housing price/rent data for {city}...")
        result = clean_housing_price(city=city)
        print(result.to_string(index=False))
        print()
