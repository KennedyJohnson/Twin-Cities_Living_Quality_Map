"""Load OSM house-type buildings into Supabase's PostGIS `houses` table.

The ~85K+ houses in the metro are too many to ship as static JSON like
apartment_buildings_{city}.json, so they live in PostGIS and the map fetches
only the visible viewport through the houses_in_bbox() RPC. Schema:
supabase/migrations/20260923010000_health_checks_and_houses.sql.

Upserts every house found in the current OSM extract, then deletes rows this
run didn't touch (buildings removed from OSM). No reverse geocoding: houses
without addr:* tags just have a null address.

Needs SUPABASE_URL / SUPABASE_SECRET_KEY; skips (exit 0) if unset.
"""
import math
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import requests

PIPELINE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PIPELINE_DIR))
import core.load  # noqa: E402,F401  (loads pipeline/.env)
from core.osm_extract import query_osm  # noqa: E402

# Same metro bbox clean_apartment_buildings.py uses, as (south, west, north, east).
BBOX = (44.85, -93.35, 45.05, -92.95)
HOUSE_TYPES = {"house", "detached", "semidetached_house", "terrace", "bungalow"}

# Most metro footprints are bulk imports tagged only building=yes (93% of
# buildings in Highland Park, e.g.), so explicit house tags alone badly
# undercount some neighborhoods. A building=yes way is kept as an
# "inferred_house" when its footprint is house-sized and it carries no tag
# suggesting another use. Area range calibrated against explicitly tagged
# buildings in Highland Park: house/detached p10-p90 ~75-280 m^2, garages
# p90 ~63 m^2.
INFERRED_MIN_M2, INFERRED_MAX_M2 = 70, 400
# building=residential gets the same treatment: St. Paul has ~7,200 of them
# (vs ~1,000 in Minneapolis), nearly all house-sized, so skipping them
# undercounted St. Paul relative to Minneapolis.
GENERIC_TYPES = {"yes", "residential"}
NON_RESIDENTIAL_KEYS = {"name", "amenity", "shop", "office", "craft", "leisure", "tourism",
                        "healthcare", "brand", "religion", "sport", "man_made", "emergency"}
BATCH_SIZE = 2000


def _is_house(tags):
    return tags.get("building") in HOUSE_TYPES


def _is_candidate(tags):
    b = tags.get("building")
    return b in HOUSE_TYPES or (b in GENERIC_TYPES and not NON_RESIDENTIAL_KEYS & tags.keys())


def _footprint_m2(coords):
    lat0 = math.radians(coords[0][0])
    pts = [(lon * 111320 * math.cos(lat0), lat * 110540) for lat, lon in coords]
    return abs(sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(pts, pts[1:] + pts[:1]))) / 2


def _house_sized(tags, coords):
    if tags.get("building") not in GENERIC_TYPES:
        return True
    return INFERRED_MIN_M2 <= _footprint_m2(coords) <= INFERRED_MAX_M2


def _address(tags):
    num, street = tags.get("addr:housenumber"), tags.get("addr:street")
    if num and street:
        return f"{num} {street}"
    return street or None


def build_rows():
    elements = query_osm(node_matcher=_is_house, way_matcher=_is_candidate,
                         way_geometry_filter=_house_sized, bbox=BBOX, cache_key="houses_v3")
    rows = []
    for el in elements:
        if el["type"] == "node":
            lat, lon = el["lat"], el["lon"]
        else:
            lat, lon = el["center"]["lat"], el["center"]["lon"]
        rows.append({
            "osm_id": f"{el['type']}/{el['id']}",
            "building_type": "inferred_house" if el["tags"]["building"] in GENERIC_TYPES else el["tags"]["building"],
            "address": _address(el["tags"]),
            "geom": f"SRID=4326;POINT({lon:.6f} {lat:.6f})",
        })
    return rows


def main():
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SECRET_KEY")
    if not url or not key:
        print("[SKIP] SUPABASE_URL / SUPABASE_SECRET_KEY not set; not loading houses")
        return

    rows = build_rows()
    print(f"[OK] Found {len(rows)} houses in OSM extract")
    if not rows:
        return

    rest = f"{url.rstrip('/')}/rest/v1"
    headers = {"apikey": key, "Content-Type": "application/json",
               "Prefer": "resolution=merge-duplicates,return=minimal"}
    run_started = datetime.now(timezone.utc).isoformat()
    for r in rows:
        r["updated_at"] = run_started

    for i in range(0, len(rows), BATCH_SIZE):
        resp = requests.post(f"{rest}/houses?on_conflict=osm_id", headers=headers,
                             json=rows[i:i + BATCH_SIZE], timeout=120)
        resp.raise_for_status()
        print(f"  upserted {min(i + BATCH_SIZE, len(rows))}/{len(rows)}")

    # Anything not refreshed this run is gone from OSM.
    resp = requests.delete(f"{rest}/houses", params={"updated_at": f"lt.{run_started}"},
                           headers={**headers, "Prefer": "return=minimal"}, timeout=120)
    resp.raise_for_status()
    print("[OK] Houses layer synced to Supabase")


if __name__ == "__main__":
    main()
