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
from core.load import resolve_boundaries, get_latest_acs_year

PIPELINE_DIR = Path(__file__).resolve().parent.parent


def _acs_url(year):
    return f"https://api.census.gov/data/{year}/acs/acs5"

# Median home value, median gross rent, median household income, total
# population, poverty universe + count below poverty line, renter
# households by gross-rent-as-%-of-income bracket (30-34.9, 35-39.9,
# 40-49.9, 50+ = cost-burdened) + total renter households (universe),
# occupied housing units by tenure (total + owner-occupied),
# households universe + households with no internet access (broadband proxy),
# unemployed labor-force count (opportunity trend proxy), Gini index of
# income inequality, and occupied/vacant housing units (vacancy rate)
ACS_VARS = (
    "B25077_001E,B25064_001E,B19013_001E,B01003_001E,"
    "B17001_001E,B17001_002E,"
    "B25070_001E,B25070_007E,B25070_008E,B25070_009E,B25070_010E,"
    "B25003_001E,B25003_002E,"
    "B28002_001E,B28002_013E,"
    "B23025_005E,"
    "B19083_001E,"
    "B25002_001E,B25002_003E,"
    # education (25+): universe, bachelor's, master's, professional, doctorate
    "B15003_001E,B15003_022E,B15003_023E,B15003_024E,B15003_025E,"
    # median age
    "B01002_001E,"
    # commute: aggregate travel minutes, workers universe, transit, bicycle, walked, work from home
    "B08013_001E,B08301_001E,B08301_010E,B08301_018E,B08301_019E,B08301_021E,"
    # race/ethnicity (for diversity index): total, white NH, Black NH, AIAN NH, Asian NH, NHPI NH, other NH, two+ NH, Hispanic
    "B03002_001E,B03002_003E,B03002_004E,B03002_005E,B03002_006E,B03002_007E,B03002_008E,B03002_009E,B03002_012E"
)

# Informational-only tract fields (shown in the sidebar, not part of the score)
INFO_FIELDS = [
    "bachelors_rate", "median_age", "avg_commute_min",
    "transit_commute_rate", "walk_commute_rate", "bike_commute_rate", "wfh_rate",
    "diversity_index",
]

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


ACS_YEAR = get_latest_acs_year(_load_census_api_key())


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

    household_universe = pd.to_numeric(df["B28002_001E"], errors="coerce")
    no_internet = pd.to_numeric(df["B28002_013E"], errors="coerce")
    df["broadband_rate"] = (100 - no_internet / household_universe * 100).where(household_universe > 0)

    unemployed = pd.to_numeric(df["B23025_005E"], errors="coerce")
    df["unemployment_rate_pc"] = (unemployed / df["population"] * 1000).where(df["population"] > 0)

    df["gini_index"] = pd.to_numeric(df["B19083_001E"], errors="coerce")

    housing_universe = pd.to_numeric(df["B25002_001E"], errors="coerce")
    vacant_units = pd.to_numeric(df["B25002_003E"], errors="coerce")
    df["vacancy_rate"] = (vacant_units / housing_universe * 100).where(housing_universe > 0)

    def num(col):
        return pd.to_numeric(df[col], errors="coerce")

    edu_universe = num("B15003_001E")
    bachelors_plus = sum(num(c) for c in ["B15003_022E", "B15003_023E", "B15003_024E", "B15003_025E"])
    df["bachelors_rate"] = (bachelors_plus / edu_universe * 100).where(edu_universe > 0)

    df["median_age"] = num("B01002_001E").where(num("B01002_001E") > 0)

    workers = num("B08301_001E")
    wfh = num("B08301_021E")
    commuters = workers - wfh
    df["avg_commute_min"] = (num("B08013_001E") / commuters).where((commuters > 0) & (num("B08013_001E") >= 0))
    df["transit_commute_rate"] = (num("B08301_010E") / workers * 100).where(workers > 0)
    df["walk_commute_rate"] = (num("B08301_019E") / workers * 100).where(workers > 0)
    df["bike_commute_rate"] = (num("B08301_018E") / workers * 100).where(workers > 0)
    df["wfh_rate"] = (wfh / workers * 100).where(workers > 0)

    # Simpson diversity index: probability two random residents differ in
    # race/ethnicity group (0 = homogeneous, ~0.8+ = highly diverse)
    race_total = num("B03002_001E")
    groups = ["B03002_003E", "B03002_004E", "B03002_005E", "B03002_006E",
              "B03002_007E", "B03002_008E", "B03002_009E", "B03002_012E"]
    df["diversity_index"] = (1 - sum((num(c) / race_total) ** 2 for c in groups)).where(race_total > 0)

    # Census codes negative sentinel values (e.g. -666666666) for unavailable estimates
    df.loc[df["median_home_value"] < 0, "median_home_value"] = None
    df.loc[df["median_gross_rent"] < 0, "median_gross_rent"] = None
    df.loc[df["median_household_income"] < 0, "median_household_income"] = None
    df.loc[poverty_count < 0, "poverty_rate"] = None
    df.loc[cost_burdened_count < 0, "housing_cost_burden_rate"] = None
    df.loc[owner_occupied < 0, "homeownership_rate"] = None
    df.loc[no_internet < 0, "broadband_rate"] = None
    df.loc[unemployed < 0, "unemployment_rate_pc"] = None
    df.loc[df["gini_index"] < 0, "gini_index"] = None
    df.loc[vacant_units < 0, "vacancy_rate"] = None
    df.loc[(num("B08013_001E") < 0) | (num("B08301_001E") < 0) | (wfh < 0), INFO_FIELDS[2:7]] = None
    df.loc[(edu_universe < 0) | (bachelors_plus < 0), "bachelors_rate"] = None
    df.loc[race_total < 0, "diversity_index"] = None
    return df[[
        "geoid", "median_home_value", "median_gross_rent", "median_household_income",
        "poverty_rate", "housing_cost_burden_rate", "homeownership_rate", "broadband_rate",
        "unemployment_rate_pc", "gini_index", "vacancy_rate", "population",
    ] + INFO_FIELDS]


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
        poverty_rate, housing_cost_burden_rate, homeownership_rate,
        gini_index, vacancy_rate
    """
    county_fips = CITY_COUNTY[city]
    acs = _fetch_acs_tracts(county_fips, year=year)
    centroids = _fetch_tract_centroids(county_fips)
    tracts = acs.merge(centroids, on="geoid", how="inner")
    return tracts[[
        "geoid", "lat", "lon", "population", "median_home_value", "median_gross_rent",
        "median_household_income", "poverty_rate", "housing_cost_burden_rate", "homeownership_rate",
        "broadband_rate", "unemployment_rate_pc", "gini_index", "vacancy_rate",
    ] + INFO_FIELDS]


def clean_housing_price(city="stpaul", year=ACS_YEAR, granularity="district"):
    """
    Fetch ACS median home value / gross rent per tract and aggregate to
    district or zip level (population-weighted mean) via tract-centroid
    spatial join. granularity: 'district' or 'zip'.

    Note on tract vintage: TIGERweb's "current" tract boundaries are 2020
    Census vintage. ACS years >= 2020 match that vintage; earlier years use
    2010-vintage tract GEOIDs, which are mostly but not always identical —
    a handful of tracts may fail to join for years before 2020.

    Returns:
        DataFrame with columns: district_id, median_home_value, median_gross_rent, median_household_income
    """
    tracts = clean_housing_price_tracts(city=city, year=year)

    boundaries = resolve_boundaries(city=city, granularity=granularity)
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

    def weighted_mean(group, col, decimals=0):
        valid = group.dropna(subset=[col, "population"])
        valid = valid[valid["population"] > 0]
        if valid.empty:
            return None
        return round((valid[col] * valid["population"]).sum() / valid["population"].sum(), decimals)

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
            "broadband_rate": weighted_mean(group, "broadband_rate"),
            "unemployment_rate_pc": weighted_mean(group, "unemployment_rate_pc"),
            # Population-weighted average of tract Gini values, not a
            # recomputed district-level Gini (which would need household
            # income microdata, not published at tract level) — an
            # approximation suitable for relative comparison across
            # districts, not an exact inequality measure.
            "gini_index": weighted_mean(group, "gini_index", decimals=3),
            "vacancy_rate": weighted_mean(group, "vacancy_rate", decimals=1),
            **{f: weighted_mean(group, f, decimals=3 if f == "diversity_index" else 1) for f in INFO_FIELDS},
        })

    return pd.DataFrame(rows, columns=[
        "district_id", "median_home_value", "median_gross_rent", "median_household_income",
        "poverty_rate", "housing_cost_burden_rate", "homeownership_rate", "broadband_rate",
        "unemployment_rate_pc", "gini_index", "vacancy_rate",
    ] + INFO_FIELDS)


if __name__ == "__main__":
    for city in ["stpaul", "mpls"]:
        print(f"Fetching housing price/rent data for {city}...")
        result = clean_housing_price(city=city)
        print(result.to_string(index=False))
        print()
