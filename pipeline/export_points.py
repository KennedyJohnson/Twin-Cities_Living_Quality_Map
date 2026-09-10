"""
Export point/line geometry for each data source, per city, as lightweight
GeoJSON files for the frontend map (web/public/data/points_<city>.json,
lines_<city>.json). Large sources are randomly sampled to keep file sizes
browser-friendly.

Run: python export_points.py
"""

import json
from pathlib import Path

import pandas as pd

from clean_permits import clean_permits
from clean_requests import clean_requests
from clean_housing import clean_housing
from clean_permits_mpls import clean_permits_mpls
from clean_housing_mpls import clean_housing_mpls
from clean_requests_mpls import clean_requests_mpls
from clean_crime_mpls import clean_crime_mpls
from clean_transit import _fetch_nodes as _fetch_transit_nodes
from clean_schools import _fetch_nodes as _fetch_school_nodes
from clean_walkability import _fetch_ways

PIPELINE_DIR = Path(__file__).parent
OUT_DIR = PIPELINE_DIR.parent / "web" / "public" / "data"

MAX_POINTS_PER_SOURCE = 3000
MAX_WAYS = 4000


def _sample(df, n=MAX_POINTS_PER_SOURCE, seed=42):
    if len(df) <= n:
        return df
    return df.sample(n=n, random_state=seed)


def _points_feature_collection(records):
    """records: list of (lon, lat, source, label) tuples"""
    features = []
    for lon, lat, source, label in records:
        if pd.isna(lon) or pd.isna(lat):
            continue
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [float(lon), float(lat)]},
            "properties": {"source": source, "label": label},
        })
    return {"type": "FeatureCollection", "features": features}


def _export_stpaul_points():
    records = []

    permits = _sample(clean_permits())
    for _, r in permits.iterrows():
        records.append((r["Longtitude"], r["Latitude"], "permits", "Building Permit"))

    requests = _sample(clean_requests())
    for _, r in requests.iterrows():
        records.append((r["Longtitude"], r["Latitude"], "requests", "Service Request"))

    housing = clean_housing()
    housing = housing[housing["district_id"].notna()]
    lat_col = next((c for c in housing.columns if c.lower() in ["latitude", "lat"]), None)
    lon_col = next((c for c in housing.columns if c.lower() in ["longitude", "lon", "longtitude"]), None)
    if lat_col and lon_col:
        housing = _sample(housing)
        for _, r in housing.iterrows():
            records.append((r[lon_col], r[lat_col], "housing", "Housing Production"))

    try:
        transit_nodes = _fetch_transit_nodes()
        for el in transit_nodes:
            lat, lon = el.get("lat"), el.get("lon")
            if lat is None or lon is None:
                continue
            tags = el.get("tags", {})
            mode = "rail" if (tags.get("railway") in ("station", "halt", "tram_stop") or tags.get("station") == "light_rail") else "bus"
            records.append((lon, lat, "transit", f"Transit ({mode})"))
    except Exception as e:
        print(f"[WARNING] St. Paul transit fetch failed: {e}")

    try:
        school_nodes = _fetch_school_nodes()
        for el in school_nodes:
            lat, lon = el.get("lat"), el.get("lon")
            if lat is None or lon is None:
                center = el.get("center") or {}
                lat, lon = center.get("lat"), center.get("lon")
            if lat is None or lon is None:
                continue
            records.append((lon, lat, "schools", "School"))
    except Exception as e:
        print(f"[WARNING] St. Paul schools fetch failed: {e}")

    return _points_feature_collection(records)


def _export_mpls_points():
    records = []

    permits = clean_permits_mpls()
    if "longitude" in permits.columns:
        permits = _sample(permits)
        for _, r in permits.iterrows():
            records.append((r["longitude"], r["latitude"], "permits", "Building Permit"))

    housing = clean_housing_mpls()
    if "longitude" in housing.columns:
        housing = _sample(housing)
        for _, r in housing.iterrows():
            records.append((r["longitude"], r["latitude"], "housing", "Housing Production (Res Permit)"))

    requests = clean_requests_mpls()
    requests = _sample(requests)
    for _, r in requests.iterrows():
        records.append((r["longitude"], r["latitude"], "requests", "311 Service Request"))

    crime = clean_crime_mpls()
    if "longitude" in crime.columns:
        crime = _sample(crime)
        for _, r in crime.iterrows():
            records.append((r["longitude"], r["latitude"], "crime", "Crime Incident"))

    try:
        transit_nodes = _fetch_transit_nodes()
        for el in transit_nodes:
            lat, lon = el.get("lat"), el.get("lon")
            if lat is None or lon is None:
                continue
            tags = el.get("tags", {})
            mode = "rail" if (tags.get("railway") in ("station", "halt", "tram_stop") or tags.get("station") == "light_rail") else "bus"
            records.append((lon, lat, "transit", f"Transit ({mode})"))
    except Exception as e:
        print(f"[WARNING] MPLS transit fetch failed: {e}")

    try:
        school_nodes = _fetch_school_nodes()
        for el in school_nodes:
            lat, lon = el.get("lat"), el.get("lon")
            if lat is None or lon is None:
                center = el.get("center") or {}
                lat, lon = center.get("lat"), center.get("lon")
            if lat is None or lon is None:
                continue
            records.append((lon, lat, "schools", "School"))
    except Exception as e:
        print(f"[WARNING] MPLS schools fetch failed: {e}")

    return _points_feature_collection(records)


def _export_trail_lines():
    """Trails are city-agnostic (single Overpass bbox already covers the metro),
    so we export one shared lines file rather than per-city."""
    try:
        elements = _fetch_ways()
    except Exception as e:
        print(f"[WARNING] Trail fetch failed: {e}")
        return {"type": "FeatureCollection", "features": []}

    elements = elements[:MAX_WAYS]
    features = []
    for el in elements:
        geometry = el.get("geometry")
        if not geometry or len(geometry) < 2:
            continue
        coords = [[pt["lon"], pt["lat"]] for pt in geometry]
        features.append({
            "type": "Feature",
            "geometry": {"type": "LineString", "coordinates": coords},
            "properties": {"source": "trails", "label": "Trail/Path"},
        })
    return {"type": "FeatureCollection", "features": features}


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    print("Exporting St. Paul points...")
    stpaul_points = _export_stpaul_points()
    (OUT_DIR / "points_stpaul.json").write_text(json.dumps(stpaul_points))
    print(f"[OK] {len(stpaul_points['features'])} St. Paul point features")

    print("Exporting Minneapolis points...")
    mpls_points = _export_mpls_points()
    (OUT_DIR / "points_mpls.json").write_text(json.dumps(mpls_points))
    print(f"[OK] {len(mpls_points['features'])} MPLS point features")

    print("Exporting trail lines...")
    trail_lines = _export_trail_lines()
    (OUT_DIR / "lines_trails.json").write_text(json.dumps(trail_lines))
    print(f"[OK] {len(trail_lines['features'])} trail line features")


if __name__ == "__main__":
    main()
