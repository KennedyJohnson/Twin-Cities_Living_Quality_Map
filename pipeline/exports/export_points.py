"""
Export point/line geometry for each data source, per city, as lightweight
GeoJSON files for the frontend map (web/public/data/points_<city>.json,
lines_<city>.json). Large sources are randomly sampled to keep file sizes
browser-friendly. Each feature carries a "title" and a "details" dict with
whatever descriptive fields are available from the source, for richer map
popups.

Run: python export_points.py
"""

import sys
from pathlib import Path as _BootstrapPath
sys.path.insert(0, str(_BootstrapPath(__file__).resolve().parent.parent))


import json
import math
import random
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
from shapely.geometry import Point, shape

from core.load import load_boundaries
from cleaners.clean_crime_mpls import clean_crime_mpls
from cleaners.clean_transit import _fetch_nodes as _fetch_transit_nodes
from cleaners.clean_schools import _fetch_nodes as _fetch_school_nodes
from cleaners.clean_groceries import _fetch_nodes as _fetch_grocery_nodes
from cleaners.clean_healthcare import _fetch_nodes as _fetch_healthcare_nodes
from cleaners.clean_walkability import _fetch_ways

PIPELINE_DIR = Path(__file__).resolve().parent.parent
OUT_DIR = PIPELINE_DIR.parent / "web" / "public" / "data"

MAX_POINTS_PER_SOURCE = 3000
MAX_WAYS = 6000


def _sample(df, n=MAX_POINTS_PER_SOURCE, seed=42):
    if len(df) <= n:
        return df
    return df.sample(n=n, random_state=seed)


def _clean(value):
    """Return a JSON-safe, display-friendly value, or None to omit the field."""
    if value is None:
        return None
    if isinstance(value, float) and math.isnan(value):
        return None
    if isinstance(value, str):
        value = value.strip()
        if not value or value.lower() in ("nan", "none", "null"):
            return None
        return value
    return value


def _format_epoch_ms(value):
    """ArcGIS FeatureServer date fields (e.g. MPLS crime's occurred_date)
    come back as epoch milliseconds; render them as a readable date."""
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return None
    try:
        return datetime.fromtimestamp(int(value) / 1000, tz=timezone.utc).strftime("%Y-%m-%d %I:%M %p")
    except (ValueError, OSError, OverflowError):
        return None


def _details(row, field_map):
    """field_map: {source_col: display_label}. Returns {label: value} skipping empties."""
    out = {}
    for col, label in field_map.items():
        if col not in row:
            continue
        val = _clean(row[col])
        if val is not None:
            out[label] = val
    return out


def _points_feature_collection(records):
    """records: list of (lon, lat, source, title, details, district_id) tuples"""
    features = []
    for lon, lat, source, title, details, district_id in records:
        if pd.isna(lon) or pd.isna(lat):
            continue
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [float(lon), float(lat)]},
            "properties": {
                "source": source,
                "label": title,
                "details": details,
                "district_id": None if district_id is None or pd.isna(district_id) else int(district_id),
            },
        })
    return {"type": "FeatureCollection", "features": features}


def _load_boundary_map(city):
    boundaries = load_boundaries(city=city)
    boundary_map = {}
    for feature in boundaries["features"]:
        district_id = feature["properties"]["district_id"]
        boundary_map[district_id] = shape(feature["geometry"])
    return boundary_map


def _find_district(lon, lat, boundary_map):
    point = Point(lon, lat)
    for district_id, polygon in boundary_map.items():
        if polygon.contains(point):
            return district_id
    return None


def _export_stpaul_points():
    records = []
    boundary_map = _load_boundary_map("stpaul")

    # St. Paul crime data has no geocoded lat/lon — only a district and a
    # block-level address string — so individual incidents aren't plotted
    # as markers (a random point within the district would imply a false
    # precision we don't have). Crime still feeds the Safety index via
    # crime_rate_pc; MPLS crime does have real coordinates and is plotted.

    # Building permits, service requests, and housing production are
    # intentionally excluded from the map's point layers (too granular /
    # low user interest) — they're still used in health score aggregation,
    # just not plotted as markers.

    records += _fetch_transit_records(boundary_map)
    records += _fetch_school_records(boundary_map)
    records += _fetch_grocery_records(boundary_map)
    records += _fetch_healthcare_records(boundary_map)

    return _points_feature_collection(records)


def _fetch_transit_records(boundary_map):
    records = []
    try:
        transit_nodes = _fetch_transit_nodes()
    except Exception as e:
        print(f"[WARNING] Transit fetch failed: {e}")
        return records

    for el in transit_nodes:
        lat, lon = el.get("lat"), el.get("lon")
        if lat is None or lon is None:
            continue
        tags = el.get("tags", {})
        mode = "rail" if (tags.get("railway") in ("station", "halt", "tram_stop") or tags.get("station") == "light_rail") else "bus"
        title = _clean(tags.get("name")) or f"Transit Stop ({mode.title()})"
        details = {}
        if _clean(tags.get("network")):
            details["Network"] = tags["network"]
        if _clean(tags.get("operator")):
            details["Operator"] = tags["operator"]
        if _clean(tags.get("route_ref")):
            details["Route"] = tags["route_ref"]
        details["Mode"] = mode.title()
        district_id = _find_district(lon, lat, boundary_map)
        if district_id is None:
            continue  # outside this city's boundaries — avoid cross-city duplicates
        records.append((lon, lat, "transit", title, details, district_id))
    return records


def _fetch_school_records(boundary_map):
    records = []
    try:
        school_nodes = _fetch_school_nodes()
    except Exception as e:
        print(f"[WARNING] Schools fetch failed: {e}")
        return records

    for el in school_nodes:
        lat, lon = el.get("lat"), el.get("lon")
        if lat is None or lon is None:
            center = el.get("center") or {}
            lat, lon = center.get("lat"), center.get("lon")
        if lat is None or lon is None:
            continue
        tags = el.get("tags", {})
        title = _clean(tags.get("name")) or "School"
        details = {}
        if _clean(tags.get("amenity")):
            details["Type"] = tags["amenity"].replace("_", " ").title()
        if _clean(tags.get("operator")):
            details["Operator"] = tags["operator"]
        if _clean(tags.get("addr:housenumber")) and _clean(tags.get("addr:street")):
            details["Address"] = f"{tags['addr:housenumber']} {tags['addr:street']}"
        district_id = _find_district(lon, lat, boundary_map)
        if district_id is None:
            continue  # outside this city's boundaries — avoid cross-city duplicates
        records.append((lon, lat, "schools", title, details, district_id))
    return records


def _fetch_grocery_records(boundary_map):
    records = []
    try:
        grocery_nodes = _fetch_grocery_nodes()
    except Exception as e:
        print(f"[WARNING] Grocery stores fetch failed: {e}")
        return records

    for el in grocery_nodes:
        lat, lon = el.get("lat"), el.get("lon")
        if lat is None or lon is None:
            center = el.get("center") or {}
            lat, lon = center.get("lat"), center.get("lon")
        if lat is None or lon is None:
            continue
        tags = el.get("tags", {})
        title = _clean(tags.get("name")) or "Grocery Store"
        details = {}
        if _clean(tags.get("shop")):
            details["Type"] = tags["shop"].replace("_", " ").title()
        if _clean(tags.get("brand")):
            details["Brand"] = tags["brand"]
        if _clean(tags.get("addr:housenumber")) and _clean(tags.get("addr:street")):
            details["Address"] = f"{tags['addr:housenumber']} {tags['addr:street']}"
        district_id = _find_district(lon, lat, boundary_map)
        if district_id is None:
            continue  # outside this city's boundaries — avoid cross-city duplicates
        records.append((lon, lat, "groceries", title, details, district_id))
    return records


def _fetch_healthcare_records(boundary_map):
    records = []
    try:
        healthcare_nodes = _fetch_healthcare_nodes()
    except Exception as e:
        print(f"[WARNING] Healthcare fetch failed: {e}")
        return records

    for el in healthcare_nodes:
        lat, lon = el.get("lat"), el.get("lon")
        if lat is None or lon is None:
            center = el.get("center") or {}
            lat, lon = center.get("lat"), center.get("lon")
        if lat is None or lon is None:
            continue
        tags = el.get("tags", {})
        title = _clean(tags.get("name")) or "Healthcare Facility"
        details = {}
        kind = _clean(tags.get("amenity")) or _clean(tags.get("healthcare"))
        if kind:
            details["Type"] = kind.replace("_", " ").title()
        if _clean(tags.get("operator")):
            details["Operator"] = tags["operator"]
        if _clean(tags.get("addr:housenumber")) and _clean(tags.get("addr:street")):
            details["Address"] = f"{tags['addr:housenumber']} {tags['addr:street']}"
        district_id = _find_district(lon, lat, boundary_map)
        if district_id is None:
            continue  # outside this city's boundaries — avoid cross-city duplicates
        records.append((lon, lat, "healthcare", title, details, district_id))
    return records


CRIME_FIELDS_MPLS = {
    "address": "Address",
    "offense": "Offense",
    "offense_category": "Category",
    "precinct": "Precinct",
    "occurred_date": "Occurred Date",
}


def _export_mpls_points():
    records = []
    boundary_map = _load_boundary_map("mpls")

    # Building permits, service requests, and housing production are
    # intentionally excluded from the map's point layers (too granular /
    # low user interest) — they're still used in health score aggregation,
    # just not plotted as markers.

    crime = clean_crime_mpls()
    if "longitude" in crime.columns:
        crime = _sample(crime)
        if "occurred_date" in crime.columns:
            crime = crime.copy()
            crime["occurred_date"] = crime["occurred_date"].map(_format_epoch_ms)
        for _, r in crime.iterrows():
            title = _clean(r.get("offense")) or _clean(r.get("offense_category")) or "Crime Incident"
            records.append((r["longitude"], r["latitude"], "crime", title, _details(r, CRIME_FIELDS_MPLS), r.get("district_id")))

    records += _fetch_transit_records(boundary_map)
    records += _fetch_school_records(boundary_map)
    records += _fetch_grocery_records(boundary_map)
    records += _fetch_healthcare_records(boundary_map)

    return _points_feature_collection(records)


def _export_trail_lines():
    """Trails are city-agnostic (single Overpass bbox already covers the metro),
    so we export one shared lines file rather than per-city."""
    try:
        elements = _fetch_ways()
    except Exception as e:
        print(f"[WARNING] Trail fetch failed: {e}")
        return {"type": "FeatureCollection", "features": []}

    if len(elements) > MAX_WAYS:
        random.Random(42).shuffle(elements)
        elements = elements[:MAX_WAYS]
    features = []
    for el in elements:
        geometry = el.get("geometry")
        if not geometry or len(geometry) < 2:
            continue
        coords = [[pt["lon"], pt["lat"]] for pt in geometry]
        tags = el.get("tags", {})
        title = _clean(tags.get("name")) or "Trail / Path"
        details = {}
        if _clean(tags.get("highway")):
            details["Type"] = tags["highway"].replace("_", " ").title()
        if _clean(tags.get("surface")):
            details["Surface"] = tags["surface"].title()
        features.append({
            "type": "Feature",
            "geometry": {"type": "LineString", "coordinates": coords},
            "properties": {"source": "trails", "label": title, "details": details},
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
