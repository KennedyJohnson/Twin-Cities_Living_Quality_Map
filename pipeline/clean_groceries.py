"""
Clean Grocery Store Access data: fetch supermarkets and grocery stores from
OpenStreetMap (via the Overpass API) and count them within each district as
a proxy for food access.

Point-record metric like transit/schools: one row per store, counted per
district_id by aggregate_by_source().
"""

import time
import requests
from http_cache import cached_post
import pandas as pd
from pathlib import Path
from load import load_boundaries
from shapely.geometry import Point, shape

PIPELINE_DIR = Path(__file__).parent
OVERPASS_URL = "https://overpass-api.de/api/interpreter"

# Twin Cities bounding box (south, west, north, east) - covers both
# St. Paul and Minneapolis so this loader works for either city's districts.
BBOX = "44.85, -93.35, 45.05, -92.95"

OVERPASS_QUERY = f"""
[out:json][timeout:60];
(
  node["shop"="supermarket"]({BBOX});
  node["shop"="grocery"]({BBOX});
  way["shop"="supermarket"]({BBOX});
);
out center;
"""


def _fetch_nodes(max_retries=3):
    """Query Overpass API for grocery/supermarket nodes+ways.

    Overpass's public instance occasionally returns 504/429 under load; retry
    with backoff before giving up (same pattern as clean_schools.py).
    """
    headers = {
        "User-Agent": "StPaulNeighborhoodHealth/1.0 (data pipeline)",
        "Accept": "*/*"
    }
    last_error = None
    for attempt in range(max_retries):
        try:
            response = cached_post(OVERPASS_URL, data={"data": OVERPASS_QUERY}, headers=headers, timeout=120)
            response.raise_for_status()
            return response.json()["elements"]
        except Exception as e:
            last_error = e
            if attempt < max_retries - 1:
                time.sleep(15 * (attempt + 1))
    raise last_error


def clean_groceries(fallback_behavior="exclude_from_scoring_if_geography_fails", city="stpaul"):
    """
    Fetch grocery store/supermarket data from Overpass API and count
    them within each district (point-in-polygon). city: 'stpaul' or 'mpls'.

    Returns:
        DataFrame with columns: node_id, district_id, name
        (one row per store found inside a district; aggregate_by_source()
        counts rows per district_id since there is no "value" column)
    """
    boundaries = load_boundaries(city=city)

    boundary_map = {}
    for feature in boundaries["features"]:
        district_id = feature["properties"]["district_id"]
        boundary_map[district_id] = shape(feature["geometry"])

    try:
        elements = _fetch_nodes()
    except Exception as e:
        if fallback_behavior == "strict":
            raise
        print(f"[WARNING] Overpass API fetch failed ({e}); groceries will be excluded from scoring")
        return pd.DataFrame(columns=["node_id", "district_id", "name"])

    rows = []
    for element in elements:
        # ways queried with "out center" carry a "center" dict instead of lat/lon
        lat = element.get("lat")
        lon = element.get("lon")
        if lat is None or lon is None:
            center = element.get("center")
            if not center:
                continue
            lat = center.get("lat")
            lon = center.get("lon")
        if lat is None or lon is None:
            continue
        point = Point(lon, lat)

        tags = element.get("tags", {})
        name = tags.get("name", "Grocery Store")

        for district_id, polygon in boundary_map.items():
            if not polygon.contains(point):
                continue
            rows.append({
                "node_id": element.get("id"),
                "district_id": district_id,
                "name": name
            })
            break

    groceries = pd.DataFrame(rows, columns=["node_id", "district_id", "name"])

    if groceries.empty and fallback_behavior == "strict":
        raise ValueError("No grocery store data could be joined to districts")

    return groceries


if __name__ == "__main__":
    cleaned = clean_groceries()
    print(f"[OK] Cleaned grocery store data: {len(cleaned)} stores")
    if not cleaned.empty:
        totals = cleaned.groupby("district_id").size()
        print("Grocery stores by district:")
        print(totals)
