"""
Clean Healthcare Access data: fetch hospitals, clinics, doctors' offices,
and pharmacies from OpenStreetMap (via the Overpass API) and count them
within each district as a proxy for access to healthcare.

Point-record metric like groceries/schools: one row per facility, counted
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
[out:json][timeout:90];
(
  nwr["amenity"="hospital"]({BBOX});
  nwr["healthcare"="hospital"]({BBOX});
  nwr["amenity"="clinic"]({BBOX});
  nwr["healthcare"="clinic"]({BBOX});
  nwr["amenity"="doctors"]({BBOX});
  nwr["healthcare"="doctor"]({BBOX});
  nwr["amenity"="pharmacy"]({BBOX});
  nwr["healthcare"="pharmacy"]({BBOX});
);
out center;
"""


def _fetch_nodes(max_retries=3):
    """Query Overpass API for healthcare facility nodes+ways.

    Overpass's public instance occasionally returns 504/429 under load; retry
    with backoff before giving up (same pattern as clean_groceries.py).
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


def clean_healthcare(fallback_behavior="exclude_from_scoring_if_geography_fails", city="stpaul"):
    """
    Fetch healthcare facility data from Overpass API and count them within
    each district (point-in-polygon). city: 'stpaul' or 'mpls'.

    Returns:
        DataFrame with columns: node_id, district_id, kind
        (one row per facility found inside a district; aggregate_by_source()
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
        print(f"[WARNING] Overpass API fetch failed ({e}); healthcare will be excluded from scoring")
        return pd.DataFrame(columns=["node_id", "district_id", "kind"])

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
        kind = tags.get("amenity") or tags.get("healthcare") or "healthcare"

        for district_id, polygon in boundary_map.items():
            if not polygon.contains(point):
                continue
            rows.append({
                "node_id": element.get("id"),
                "district_id": district_id,
                "kind": kind
            })
            break

    healthcare = pd.DataFrame(rows, columns=["node_id", "district_id", "kind"])

    if healthcare.empty and fallback_behavior == "strict":
        raise ValueError("No healthcare facility data could be joined to districts")

    return healthcare


if __name__ == "__main__":
    cleaned = clean_healthcare()
    print(f"[OK] Cleaned healthcare facility data: {len(cleaned)} facilities")
    if not cleaned.empty:
        totals = cleaned.groupby("district_id").size()
        print("Healthcare facilities by district:")
        print(totals)
        print("\nBy kind:")
        print(cleaned["kind"].value_counts())
