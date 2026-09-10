"""
Clean Service Requests data and assign districts via spatial join of lat/long.
Since District Council column has 49+ unique values, we rebuild from lat/long.
"""

import sys
from pathlib import Path as _BootstrapPath
sys.path.insert(0, str(_BootstrapPath(__file__).resolve().parent.parent))


import pandas as pd
import json
from pathlib import Path
from core.load import load_requests, load_boundaries
from shapely.geometry import Point, shape

PIPELINE_DIR = Path(__file__).resolve().parent.parent

def clean_requests():
    """
    Clean requests data. Map to districts via spatial join of Latitude/Longtitude
    against boundary polygons.

    Returns:
        DataFrame with columns: request_id (or index), district_id, date, Latitude, Longtitude
    """
    requests = load_requests()
    boundaries = load_boundaries()

    # Ensure required columns exist
    if "Latitude" not in requests.columns or "Longtitude" not in requests.columns:
        raise ValueError("Requests data missing Latitude/Longtitude columns")

    # Filter for valid lat/long
    requests = requests.dropna(subset=["Latitude", "Longtitude"])

    # Build boundary lookup: district_id -> polygon
    boundary_map = {}
    for feature in boundaries["features"]:
        district_id = feature["properties"]["district_id"]
        geom = shape(feature["geometry"])
        boundary_map[district_id] = geom

    # Spatial join: for each request, find which district polygon contains it
    def find_district(row):
        try:
            point = Point(row["Longtitude"], row["Latitude"])
            for district_id, polygon in boundary_map.items():
                if polygon.contains(point):
                    return district_id
        except:
            pass
        return None

    requests["district_id"] = requests.apply(find_district, axis=1)

    # Filter out rows that couldn't be spatially joined
    before_filter = len(requests)
    requests = requests.dropna(subset=["district_id"])
    after_filter = len(requests)
    filtered_count = before_filter - after_filter
    if filtered_count > 0:
        print(f"[WARNING] Filtered {filtered_count} requests with no district match via spatial join")

    requests["district_id"] = requests["district_id"].astype(int)

    return requests

if __name__ == "__main__":
    cleaned = clean_requests()
    print(f"[OK] Cleaned requests data: {len(cleaned)} records")
    print(f"Districts represented: {sorted(cleaned['district_id'].unique())}")
