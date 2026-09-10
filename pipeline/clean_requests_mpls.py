"""
Clean Minneapolis 311 Service Requests data (ArcGIS FeatureServer) and assign
districts via spatial join. Coordinates are in EPSG:3857 (Web Mercator) and are
reprojected to WGS84 manually (no pyproj dependency) before the point-in-polygon join.
"""

import json
import math
import requests
import pandas as pd
from pathlib import Path
from shapely.geometry import Point, shape
from load import load_boundaries

PIPELINE_DIR = Path(__file__).parent
MPLS_SOURCES = json.loads((PIPELINE_DIR / "config" / "mpls_sources.json").read_text())

FEATURE_SERVER = MPLS_SOURCES["requests_311"]["featureServer"]
PAGE_SIZE = 2000


def _web_mercator_to_wgs84(x, y):
    """Convert EPSG:3857 (Web Mercator) coordinates to WGS84 lon/lat."""
    origin_shift = 20037508.34
    lon = (x / origin_shift) * 180.0
    lat = (y / origin_shift) * 180.0
    lat = 180.0 / math.pi * (2 * math.atan(math.exp(lat * math.pi / 180.0)) - math.pi / 2.0)
    return lon, lat


def _fetch_all_features(out_fields="CASEID,TYPENAME,OPENEDDATETIME,XCOORD,YCOORD"):
    query_url = f"{FEATURE_SERVER}/query"
    features = []
    offset = 0
    while True:
        params = {
            "where": "1=1",
            "outFields": out_fields,
            "resultOffset": offset,
            "resultRecordCount": PAGE_SIZE,
            "f": "json",
        }
        resp = requests.get(query_url, params=params, timeout=60)
        resp.raise_for_status()
        data = resp.json()
        batch = data.get("features", [])
        if not batch:
            break
        features.extend(batch)
        if len(batch) < PAGE_SIZE:
            break
        offset += PAGE_SIZE
    return features


def clean_requests_mpls():
    """
    Fetch Minneapolis 311 service request data and assign district_id via
    spatial join against Minneapolis Community boundaries.

    Returns:
        DataFrame with columns: district_id, case_id, request_type, opened_date
    """
    boundaries = load_boundaries(city="mpls")

    features = _fetch_all_features()
    rows = [f["attributes"] for f in features]
    svc = pd.DataFrame(rows)

    svc = svc.dropna(subset=["XCOORD", "YCOORD"])

    lonlat = svc.apply(lambda r: _web_mercator_to_wgs84(r["XCOORD"], r["YCOORD"]), axis=1)
    svc["longitude"] = lonlat.map(lambda t: t[0])
    svc["latitude"] = lonlat.map(lambda t: t[1])

    boundary_map = {}
    for feature in boundaries["features"]:
        district_id = feature["properties"]["district_id"]
        boundary_map[district_id] = shape(feature["geometry"])

    def find_district(row):
        try:
            point = Point(row["longitude"], row["latitude"])
            for district_id, polygon in boundary_map.items():
                if polygon.contains(point):
                    return district_id
        except Exception:
            pass
        return None

    svc["district_id"] = svc.apply(find_district, axis=1)

    before_filter = len(svc)
    svc = svc.dropna(subset=["district_id"])
    after_filter = len(svc)
    filtered_count = before_filter - after_filter
    if filtered_count > 0:
        print(f"[WARNING] Filtered {filtered_count} MPLS 311 records with no district match via spatial join")

    svc["district_id"] = svc["district_id"].astype(int)

    svc = svc.rename(columns={
        "CASEID": "case_id",
        "TYPENAME": "request_type",
        "OPENEDDATETIME": "opened_date",
    })

    return svc[["district_id", "case_id", "request_type", "opened_date", "longitude", "latitude"]]


if __name__ == "__main__":
    cleaned = clean_requests_mpls()
    print(f"[OK] Cleaned MPLS 311 requests data: {len(cleaned)} records")
    print(f"Districts represented: {sorted(cleaned['district_id'].unique())}")
    print(cleaned["district_id"].value_counts())
