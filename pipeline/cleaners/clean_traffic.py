"""
Clean Traffic Volume data: fetch current Annual Average Daily Traffic (AADT)
road segments from MnDOT's ArcGIS FeatureServer and compute vehicle-km
traveled (AADT x segment length) within each district.

Like walkability, this is a line-geometry metric: instead of counting
incidents, we sum (AADT * clipped length in km) for each road segment that
falls inside a district's boundary — a proxy for total traffic exposure,
analogous to vehicle-miles-traveled. Higher traffic volume per capita is
treated as a Quality of Life negative (noise, safety, walkability), so this
source is registered with rate_direction="invert".
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
from shapely.geometry import LineString, shape

PIPELINE_DIR = Path(__file__).resolve().parent.parent
FEATURE_SERVER = "https://webgis.dot.state.mn.us/65agsf1/rest/services/sdw_incdt/AADT_SEGMENT_CURRENT/FeatureServer/0"
PAGE_SIZE = 2000

# Twin Cities counties - covers both St. Paul (Ramsey) and Minneapolis
# (Hennepin) so this loader works for either city's districts.
COUNTIES = "'Ramsey','Hennepin'"


def _fetch_segments(max_retries=3):
    """Query MnDOT's AADT FeatureServer for current traffic volume segments
    in the Twin Cities, reprojected to WGS84 (outSR=4326) so they line up
    with our district boundaries without needing a UTM conversion."""
    query_url = f"{FEATURE_SERVER}/query"
    features = []
    offset = 0
    while True:
        params = {
            "where": f"COUNTY IN ({COUNTIES})",
            "outFields": "CURRENT_VOLUME,CURRENT_YEAR,COUNTY",
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


def clean_traffic(fallback_behavior="exclude_from_scoring_if_geography_fails", city="stpaul"):
    """
    Fetch current AADT road segments and compute vehicle-km traveled
    (AADT x length) within each district via line-polygon intersection.
    city: 'stpaul' or 'mpls'.

    Returns:
        DataFrame with columns: segment_id, district_id, value (vehicle-km/day)
    """
    boundaries = load_boundaries(city=city)

    boundary_map = {}
    for feature in boundaries["features"]:
        district_id = feature["properties"]["district_id"]
        boundary_map[district_id] = shape(feature["geometry"])

    try:
        features = _fetch_segments()
    except Exception as e:
        if fallback_behavior == "strict":
            raise
        print(f"[WARNING] MnDOT AADT fetch failed ({e}); traffic will be excluded from scoring")
        return pd.DataFrame(columns=["segment_id", "district_id", "value"])

    rows = []
    for i, feature in enumerate(features):
        attrs = feature.get("attributes", {})
        aadt = attrs.get("CURRENT_VOLUME")
        geometry = feature.get("geometry")
        if aadt is None or aadt <= 0 or not geometry or not geometry.get("paths"):
            continue

        try:
            # A segment can have multiple disconnected paths; treat each as
            # its own line for the intersection test.
            lines = [LineString(path) for path in geometry["paths"] if len(path) >= 2]
        except Exception:
            continue

        for district_id, polygon in boundary_map.items():
            total_length_km = 0.0
            for line in lines:
                if not line.intersects(polygon):
                    continue
                clipped = line.intersection(polygon)
                if clipped.is_empty:
                    continue
                # Approximate degrees->km conversion (good enough at this latitude)
                total_length_km += clipped.length * 111.0

            if total_length_km <= 0:
                continue

            rows.append({
                "segment_id": attrs.get("OBJECTID", i),
                "district_id": district_id,
                "value": aadt * total_length_km,
            })

    traffic = pd.DataFrame(rows, columns=["segment_id", "district_id", "value"])

    if traffic.empty and fallback_behavior == "strict":
        raise ValueError("No traffic data could be joined to districts")

    return traffic


if __name__ == "__main__":
    cleaned = clean_traffic()
    print(f"[OK] Cleaned traffic data: {len(cleaned)} segment/district rows")
    if not cleaned.empty:
        totals = cleaned.groupby("district_id")["value"].sum().round(0)
        print("Vehicle-km/day by district:")
        print(totals)
