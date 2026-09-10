"""
Clean Transit Accessibility data: fetch bus stops, light rail/train stations,
and transit platforms from OpenStreetMap (via the Overpass API) and count
stops within each district as a proxy for public transit availability
(Metro Transit buses, METRO light rail lines, etc.).

Point-record metric like crime/permits/requests: one row per stop, counted
per district_id by aggregate_by_source().
"""

import sys
from pathlib import Path as _BootstrapPath
sys.path.insert(0, str(_BootstrapPath(__file__).resolve().parent.parent))


import time
import requests
from core.http_cache import cached_post
import pandas as pd
from pathlib import Path
from core.load import load_boundaries
from shapely.geometry import Point, shape

PIPELINE_DIR = Path(__file__).resolve().parent.parent
OVERPASS_URL = "https://overpass-api.de/api/interpreter"

# Twin Cities bounding box (south, west, north, east) - covers both
# St. Paul and Minneapolis so this loader works for either city's districts.
BBOX = "44.85, -93.35, 45.05, -92.95"

OVERPASS_QUERY = f"""
[out:json][timeout:60];
(
  node["highway"="bus_stop"]({BBOX});
  node["public_transport"="platform"]({BBOX});
  node["public_transport"="stop_position"]({BBOX});
  node["railway"="station"]({BBOX});
  node["railway"="halt"]({BBOX});
  node["railway"="tram_stop"]({BBOX});
  node["station"="light_rail"]({BBOX});
);
out;
"""

def _fetch_nodes(max_retries=3):
    """Query Overpass API for transit stop/station nodes.

    Overpass's public instance occasionally returns 504/429 under load; retry
    with backoff before giving up (same pattern as clean_walkability.py).
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

def clean_transit(fallback_behavior="exclude_from_scoring_if_geography_fails", city="stpaul"):
    """
    Fetch transit stop/station data from Overpass API and count stops
    within each district (point-in-polygon). city: 'stpaul' or 'mpls'.

    Returns:
        DataFrame with columns: node_id, district_id, mode
        (one row per stop found inside a district; aggregate_by_source()
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
        print(f"[WARNING] Overpass API fetch failed ({e}); transit will be excluded from scoring")
        return pd.DataFrame(columns=["node_id", "district_id", "mode"])

    rows = []
    for element in elements:
        lat = element.get("lat")
        lon = element.get("lon")
        if lat is None or lon is None:
            continue
        point = Point(lon, lat)

        tags = element.get("tags", {})
        if tags.get("railway") in ("station", "halt", "tram_stop") or tags.get("station") == "light_rail":
            mode = "rail"
        else:
            mode = "bus"

        for district_id, polygon in boundary_map.items():
            if not polygon.contains(point):
                continue
            rows.append({
                "node_id": element.get("id"),
                "district_id": district_id,
                "mode": mode
            })
            break

    transit = pd.DataFrame(rows, columns=["node_id", "district_id", "mode"])

    if transit.empty and fallback_behavior == "strict":
        raise ValueError("No transit data could be joined to districts")

    return transit

if __name__ == "__main__":
    cleaned = clean_transit()
    print(f"[OK] Cleaned transit data: {len(cleaned)} stops/stations")
    if not cleaned.empty:
        totals = cleaned.groupby("district_id").size()
        print("Transit stops by district:")
        print(totals)
        print("\nBy mode:")
        print(cleaned["mode"].value_counts())
