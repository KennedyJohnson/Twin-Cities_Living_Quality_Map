"""
Clean Minneapolis Crime Data (ArcGIS FeatureServer) and map to Communities
via the neighborhood->community crosswalk.
"""

import json
import math
import requests
import pandas as pd
from pathlib import Path

PIPELINE_DIR = Path(__file__).parent
MPLS_SOURCES = json.loads((PIPELINE_DIR / "config" / "mpls_sources.json").read_text())
CROSSWALK_FILE = PIPELINE_DIR / "config" / "mpls_neighborhood_to_community.json"

FEATURE_SERVER = MPLS_SOURCES["crime"]["featureServer"]
PAGE_SIZE = 2000

COMMUNITY_TO_DISTRICT_ID = {
    "Calhoun Isle": 101,
    "Camden": 102,
    "Central": 103,
    "Longfellow": 104,
    "Near North": 105,
    "Nokomis": 106,
    "Northeast": 107,
    "Phillips": 108,
    "Powderhorn": 109,
    "Southwest": 110,
    "University": 111,
}


def _web_mercator_to_wgs84(x, y):
    """Convert EPSG:3857 (Web Mercator) coordinates to WGS84 lon/lat."""
    origin_shift = 20037508.34
    lon = (x / origin_shift) * 180.0
    lat = (y / origin_shift) * 180.0
    lat = 180.0 / math.pi * (2 * math.atan(math.exp(lat * math.pi / 180.0)) - math.pi / 2.0)
    return lon, lat


def _fetch_all_features(out_fields="Neighborhood,Offense_Category,Occurred_Date"):
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


def clean_crime_mpls(crosswalk_file=CROSSWALK_FILE):
    """
    Fetch Minneapolis crime data and assign district_id via crosswalk.

    Returns:
        DataFrame with columns: district_id, offense_category, occurred_date
    """
    crosswalk = json.loads(Path(crosswalk_file).read_text())

    features = _fetch_all_features()
    rows = []
    for f in features:
        attrs = dict(f["attributes"])
        geom = f.get("geometry")
        if geom and "x" in geom and "y" in geom:
            lon, lat = _web_mercator_to_wgs84(geom["x"], geom["y"])
            attrs["longitude"] = lon
            attrs["latitude"] = lat
        rows.append(attrs)
    crime = pd.DataFrame(rows)

    if "Neighborhood" not in crime.columns:
        raise ValueError("Minneapolis crime data missing Neighborhood column")

    crime["community_name"] = crime["Neighborhood"].map(
        lambda x: crosswalk.get(str(x).strip())
    )

    before_filter = len(crime)
    crime = crime.dropna(subset=["community_name"])
    after_filter = len(crime)
    filtered_count = before_filter - after_filter
    if filtered_count > 0:
        print(f"[WARNING] Filtered {filtered_count} MPLS crime records with unmapped neighborhoods")

    crime = crime.rename(columns={
        "Offense_Category": "offense_category",
        "Occurred_Date": "occurred_date",
    })

    crime["district_id"] = crime["community_name"].map(COMMUNITY_TO_DISTRICT_ID)

    cols = ["district_id", "offense_category", "occurred_date"]
    if "longitude" in crime.columns:
        cols += ["longitude", "latitude"]
    return crime[cols]


if __name__ == "__main__":
    cleaned = clean_crime_mpls()
    print(f"[OK] Cleaned MPLS crime data: {len(cleaned)} records")
    print(f"Districts represented: {sorted(cleaned['district_id'].unique())}")
    print(cleaned["district_id"].value_counts())
