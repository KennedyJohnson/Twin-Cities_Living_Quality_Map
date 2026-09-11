"""
Fetch ZIP-level "for-sale home inventory" (active listings) from Zillow
Research's free public CSV downloads (no API key required) and convert to
a per-district listing count, as an Opportunity signal — fewer homes on
the market relative to population indicates a tighter, more in-demand
housing market, so this rate is inverted (lower = higher Opportunity),
alongside permits and unemployment.

Zillow Research publishes these as static CSVs at a stable URL, refreshed
in place monthly: https://www.zillow.com/research/data/
"""

import sys
from pathlib import Path as _BootstrapPath
sys.path.insert(0, str(_BootstrapPath(__file__).resolve().parent.parent))


import io
import requests
import pandas as pd
from pathlib import Path
from shapely.geometry import Point, shape
from core.load import load_boundaries

PIPELINE_DIR = Path(__file__).resolve().parent.parent

ZILLOW_INVENTORY_CSV = (
    "https://files.zillowstatic.com/research/public_csvs/invt_fs/"
    "Zip_invt_fs_uc_sfrcondo_sm_month.csv"
)

TIGERWEB_ZCTA_URL = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer/2/query"

# Zillow's "City" field, as used in the inventory CSV, per project city
CITY_NAME = {
    "stpaul": "Saint Paul",
    "mpls": "Minneapolis",
}


def _fetch_zillow_inventory(city_name):
    resp = requests.get(ZILLOW_INVENTORY_CSV, timeout=60)
    resp.raise_for_status()
    df = pd.read_csv(io.StringIO(resp.text))
    latest_month = df.columns[-1]
    rows = df[(df["State"] == "MN") & (df["City"] == city_name)]
    rows = rows.dropna(subset=[latest_month])
    return rows[["RegionName", latest_month]].rename(
        columns={"RegionName": "zip", latest_month: "inventory"}
    )


def _fetch_zcta_centroids(zips):
    zip_list = ",".join(f"'{z}'" for z in zips)
    params = {
        "where": f"ZCTA5 IN ({zip_list})",
        "outFields": "ZCTA5,CENTLAT,CENTLON",
        "returnGeometry": "false",
        "f": "json",
    }
    resp = requests.get(TIGERWEB_ZCTA_URL, params=params, timeout=60)
    resp.raise_for_status()
    data = resp.json()
    rows = []
    for f in data.get("features", []):
        attrs = f["attributes"]
        rows.append({
            "zip": attrs["ZCTA5"],
            "lat": float(attrs["CENTLAT"]),
            "lon": float(attrs["CENTLON"]),
        })
    return pd.DataFrame(rows)


def clean_zillow_inventory(fallback_behavior="exclude_from_scoring_if_geography_fails", city="stpaul"):
    """
    Fetch Zillow's for-sale home inventory per ZIP, join to districts via
    ZIP (ZCTA) centroid point-in-polygon. city: 'stpaul' or 'mpls'.

    Returns:
        DataFrame with columns: geoid (zip), district_id, value (listing
        count; aggregate_by_source() sums this per district)
    """
    city_name = CITY_NAME[city]

    try:
        inventory = _fetch_zillow_inventory(city_name)
        if inventory.empty:
            raise ValueError("No Zillow inventory rows returned")
        centroids = _fetch_zcta_centroids(inventory["zip"].astype(str).tolist())
    except Exception as e:
        if fallback_behavior == "strict":
            raise
        print(f"[WARNING] Zillow inventory fetch failed ({e}); housing_market will be excluded from scoring")
        return pd.DataFrame(columns=["geoid", "district_id", "value"])

    inventory["zip"] = inventory["zip"].astype(str)
    merged = inventory.merge(centroids, on="zip", how="inner")

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

    merged["district_id"] = merged.apply(find_district, axis=1)
    merged = merged.dropna(subset=["district_id"])
    merged["district_id"] = merged["district_id"].astype(int)
    merged["value"] = merged["inventory"]

    result = merged[["zip", "district_id", "value"]].rename(columns={"zip": "geoid"})

    if result.empty and fallback_behavior == "strict":
        raise ValueError("No Zillow inventory data could be joined to districts")

    return result


if __name__ == "__main__":
    for city in ["stpaul", "mpls"]:
        cleaned = clean_zillow_inventory(city=city)
        print(f"[OK] Cleaned Zillow inventory data for {city}: {len(cleaned)} zips")
        totals = cleaned.groupby("district_id")["value"].sum()
        print(totals)
