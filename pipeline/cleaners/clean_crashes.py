"""
Fetch pedestrian/cyclist ("vulnerable road user") crash locations statewide
from MnDOT/MnDPS's ArcGIS FeatureServer (2016-2021) and count them within
each district, as a Safety signal — more crashes lowers Safety.

Source: https://www.arcgis.com/home/item.html?id=... "VRU Crashes 2016 to
2021 Final" (public view layer, no API key required).
"""

import sys
from pathlib import Path as _BootstrapPath
sys.path.insert(0, str(_BootstrapPath(__file__).resolve().parent.parent))


import time
import requests
from core.http_cache import cached_get
import pandas as pd
from pathlib import Path
from core.load import load_boundaries
from shapely.geometry import Point, shape

PIPELINE_DIR = Path(__file__).resolve().parent.parent
FEATURE_SERVER = "https://services.arcgis.com/qWbGMYB49y8mLbRt/arcgis/rest/services/VRU_Crashes_2016_to_2021_2_view/FeatureServer/0"
PAGE_SIZE = 2000


def _fetch_crashes(max_retries=3):
    query_url = f"{FEATURE_SERVER}/query"
    features = []
    offset = 0
    while True:
        params = {
            "where": "1=1",
            "outFields": "global_crash_severity,crash_mode",
            "outSR": 4326,
            "resultOffset": offset,
            "resultRecordCount": PAGE_SIZE,
            "f": "json",
        }
        last_error = None
        for attempt in range(max_retries):
            try:
                resp = cached_get(query_url, params=params, timeout=60)
                resp.raise_for_status()
                data = resp.json()
                break
            except Exception as e:
                last_error = e
                if attempt < max_retries - 1:
                    time.sleep(10 * (attempt + 1))
        else:
            raise last_error

        batch = data.get("features", [])
        if not batch:
            break
        features.extend(batch)
        if len(batch) < PAGE_SIZE:
            break
        offset += PAGE_SIZE
    return features


def clean_crashes(fallback_behavior="exclude_from_scoring_if_geography_fails", city="stpaul"):
    """
    Fetch pedestrian/cyclist crash locations and count them within each
    district (point-in-polygon). city: 'stpaul' or 'mpls'.

    Returns:
        DataFrame with columns: crash_id, district_id, severity
        (one row per crash found inside a district; aggregate_by_source()
        counts rows per district_id since there is no "value" column)
    """
    boundaries = load_boundaries(city=city)

    boundary_map = {}
    for feature in boundaries["features"]:
        district_id = feature["properties"]["district_id"]
        boundary_map[district_id] = shape(feature["geometry"])

    try:
        features = _fetch_crashes()
    except Exception as e:
        if fallback_behavior == "strict":
            raise
        print(f"[WARNING] MnDOT crash data fetch failed ({e}); crashes will be excluded from scoring")
        return pd.DataFrame(columns=["crash_id", "district_id", "severity"])

    rows = []
    for i, feature in enumerate(features):
        geometry = feature.get("geometry")
        if not geometry or "x" not in geometry or "y" not in geometry:
            continue
        point = Point(geometry["x"], geometry["y"])

        for district_id, polygon in boundary_map.items():
            if not polygon.contains(point):
                continue
            attrs = feature.get("attributes", {})
            rows.append({
                "crash_id": i,
                "district_id": district_id,
                "severity": attrs.get("global_crash_severity"),
            })
            break

    crashes = pd.DataFrame(rows, columns=["crash_id", "district_id", "severity"])

    if crashes.empty and fallback_behavior == "strict":
        raise ValueError("No crash data could be joined to districts")

    return crashes


if __name__ == "__main__":
    cleaned = clean_crashes()
    print(f"[OK] Cleaned crash data: {len(cleaned)} crashes")
    if not cleaned.empty:
        print(cleaned.groupby("district_id").size())
