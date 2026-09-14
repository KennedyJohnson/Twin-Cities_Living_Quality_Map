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
import pandas as pd
from pathlib import Path
from shapely.geometry import shape
from core.load import load_boundaries
from core.http_cache import cached_get

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
    resp = cached_get(ZILLOW_INVENTORY_CSV, timeout=60, response_type="text")
    resp.raise_for_status()
    df = pd.read_csv(io.StringIO(resp.text))
    latest_month = df.columns[-1]
    rows = df[(df["State"] == "MN") & (df["City"] == city_name)]
    rows = rows.dropna(subset=[latest_month])
    return rows[["RegionName", latest_month]].rename(
        columns={"RegionName": "zip", latest_month: "inventory"}
    )


def _fetch_zcta_polygons(zips):
    """
    Fetch full ZCTA (ZIP) polygon geometry, not just a centroid — needed
    for area-weighted apportionment (see clean_zillow_inventory's
    docstring for why a centroid-only join badly undercounts district
    coverage).

    Returns: {zip: shapely polygon/multipolygon}
    """
    zip_list = ",".join(f"'{z}'" for z in zips)
    params = {
        "where": f"ZCTA5 IN ({zip_list})",
        "outFields": "ZCTA5",
        "returnGeometry": "true",
        "f": "geojson",
    }
    resp = cached_get(TIGERWEB_ZCTA_URL, params=params, timeout=60)
    resp.raise_for_status()
    data = resp.json()
    polygons = {}
    for feature in data.get("features", []):
        zip_code = feature["properties"]["ZCTA5"]
        polygons[zip_code] = shape(feature["geometry"])
    return polygons


def clean_zillow_inventory(fallback_behavior="exclude_from_scoring_if_geography_fails", city="stpaul", granularity="district"):
    """
    Fetch Zillow's for-sale home inventory per ZIP. At zip granularity, the
    zip code IS the join key already — no apportionment needed, each ZIP's
    inventory count goes straight to its own district_id (the zip code).
    At district granularity, apportioned to districts by AREA OVERLAP
    between each ZIP polygon and each district polygon (assuming listings
    are spread roughly evenly across a ZIP). city: 'stpaul' or 'mpls'.

    A ZIP code covers a much bigger area than one of St. Paul's 17 (or
    Minneapolis's 11) districts, so a single "which district contains this
    ZIP's centroid" lookup put 100% of a ZIP's inventory in whichever one
    district happened to contain that one point, and left every other
    district the ZIP actually overlaps with zero coverage — 7 of St. Paul's
    17 districts had no housing_market data at all under that approach.
    Splitting each ZIP's count across every overlapping district,
    proportional to the overlap area, gives every district a (fractional
    but real) share instead of an all-or-nothing assignment.

    Returns:
        DataFrame with columns: geoid (zip), district_id, value (apportioned
        listing count; aggregate_by_source() sums this per district)
    """
    city_name = CITY_NAME[city]

    try:
        inventory = _fetch_zillow_inventory(city_name)
        if inventory.empty:
            raise ValueError("No Zillow inventory rows returned")
        inventory["zip"] = inventory["zip"].astype(str)
        if granularity != "zip":
            zip_polygons = _fetch_zcta_polygons(inventory["zip"].tolist())
    except Exception as e:
        if fallback_behavior == "strict":
            raise
        print(f"[WARNING] Zillow inventory fetch failed ({e}); housing_market will be excluded from scoring")
        return pd.DataFrame(columns=["geoid", "district_id", "value"])

    if granularity == "zip":
        result = pd.DataFrame({
            "geoid": inventory["zip"],
            "district_id": inventory["zip"].astype(int),
            "value": inventory["inventory"],
        })
        if result.empty and fallback_behavior == "strict":
            raise ValueError("No Zillow inventory data available at zip granularity")
        return result

    boundaries = load_boundaries(city=city)
    boundary_map = {}
    for feature in boundaries["features"]:
        district_id = feature["properties"]["district_id"]
        boundary_map[district_id] = shape(feature["geometry"])

    rows = []
    for _, inv_row in inventory.iterrows():
        zip_code = inv_row["zip"]
        zip_poly = zip_polygons.get(zip_code)
        if zip_poly is None or zip_poly.area == 0:
            continue

        for district_id, district_poly in boundary_map.items():
            if not zip_poly.intersects(district_poly):
                continue
            overlap_area = zip_poly.intersection(district_poly).area
            if overlap_area <= 0:
                continue
            area_fraction = overlap_area / zip_poly.area
            rows.append({
                "geoid": zip_code,
                "district_id": district_id,
                "value": inv_row["inventory"] * area_fraction,
            })

    result = pd.DataFrame(rows, columns=["geoid", "district_id", "value"])
    if not result.empty:
        result["district_id"] = result["district_id"].astype(int)

    if result.empty and fallback_behavior == "strict":
        raise ValueError("No Zillow inventory data could be joined to districts")

    return result


if __name__ == "__main__":
    for city in ["stpaul", "mpls"]:
        cleaned = clean_zillow_inventory(city=city)
        print(f"[OK] Cleaned Zillow inventory data for {city}: {len(cleaned)} zips")
        totals = cleaned.groupby("district_id")["value"].sum()
        print(totals)
