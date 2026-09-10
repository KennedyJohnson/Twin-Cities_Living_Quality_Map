"""
Clean Walkability data: fetch trails/pedestrian paths from OpenStreetMap
(via the Overpass API) and compute trail length (km) within each district.

Unlike the point-record sources (crime, permits, requests), walkability is a
line-geometry metric: instead of counting incidents, we sum the length of
each trail/path segment that falls inside a district's boundary. Output rows
are one-per-(way, district) with a "value" column in km, which
aggregate_by_source() sums per district_id.
"""

import sys
from pathlib import Path as _BootstrapPath
sys.path.insert(0, str(_BootstrapPath(__file__).resolve().parent.parent))


import json
import time
import requests
from core.http_cache import cached_post
import pandas as pd
from pathlib import Path
from core.load import load_boundaries
from shapely.geometry import LineString, shape

PIPELINE_DIR = Path(__file__).resolve().parent.parent
OVERPASS_URL = "https://overpass-api.de/api/interpreter"

# Twin Cities bounding box (south, west, north, east) - covers both St. Paul
# and Minneapolis so this loader works for either city's districts.
BBOX = "44.85, -93.35, 45.05, -92.95"

OVERPASS_QUERY = f"""
[out:json][timeout:60];
(
  way["highway"~"^(path|footway|cycleway|pedestrian|track)$"]({BBOX});
  way["leisure"="park"]({BBOX});
);
out geom;
"""

def _fetch_ways(max_retries=3):
    """Query Overpass API for trail/path ways. Returns list of dicts with geometry.

    Overpass's public instance occasionally returns 504/429 under load; retry
    with backoff before giving up.
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

def clean_walkability(fallback_behavior="exclude_from_scoring_if_geography_fails", city="stpaul"):
    """
    Fetch trail/path data from Overpass API and compute length (km) within
    each district via line-polygon intersection. city: 'stpaul' or 'mpls'.

    Returns:
        DataFrame with columns: way_id, district_id, value (length_km)
    """
    boundaries = load_boundaries(city=city)

    boundary_map = {}
    for feature in boundaries["features"]:
        district_id = feature["properties"]["district_id"]
        boundary_map[district_id] = shape(feature["geometry"])

    try:
        elements = _fetch_ways()
    except Exception as e:
        if fallback_behavior == "strict":
            raise
        print(f"[WARNING] Overpass API fetch failed ({e}); walkability will be excluded from scoring")
        return pd.DataFrame(columns=["way_id", "district_id", "value"])

    rows = []
    for element in elements:
        geometry = element.get("geometry")
        if not geometry or len(geometry) < 2:
            continue

        try:
            line = LineString([(pt["lon"], pt["lat"]) for pt in geometry])
        except Exception:
            continue

        for district_id, polygon in boundary_map.items():
            if not line.intersects(polygon):
                continue
            clipped = line.intersection(polygon)
            if clipped.is_empty:
                continue
            # Approximate degrees->km conversion (good enough at this latitude)
            length_km = clipped.length * 111.0
            if length_km <= 0:
                continue
            rows.append({
                "way_id": element.get("id"),
                "district_id": district_id,
                "value": length_km
            })

    walkability = pd.DataFrame(rows, columns=["way_id", "district_id", "value"])

    if walkability.empty and fallback_behavior == "strict":
        raise ValueError("No walkability data could be joined to districts")

    return walkability

if __name__ == "__main__":
    cleaned = clean_walkability()
    print(f"[OK] Cleaned walkability data: {len(cleaned)} way/district segments")
    if not cleaned.empty:
        totals = cleaned.groupby("district_id")["value"].sum().round(2)
        print("Trail km by district:")
        print(totals)
