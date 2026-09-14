"""
Build a local named-place index from the OSM extract (see core/osm_extract.py)
so the frontend can resolve "what is this point named?" and match named-place
search queries without calling Overpass/Nominatim live from the browser.

Replaces two runtime calls that used to hit public OSM APIs directly from
web/lib/geo.ts on every map click / search keystroke:
  - findNearestNamedPlace(): POSTed a live Overpass query for named
    buildings/shops/amenities near a clicked point.
  - reverseGeocode()'s "name" branch: relied on Nominatim's reverse result
    happening to carry a `name` tag.
Both are flaky/rate-limited in a browser (Overpass has no caching there, and
Nominatim's public policy caps at 1 req/sec app-wide). Since we already
download the whole metro-area extract for the pipeline's OSM cleaners, we can
pull every named node/way once at build time and ship a small static index
instead — the frontend then does a local nearest/substring match with zero
extra network calls, and address search only calls the Nominatim proxy for
the free-text/parcel-address matching a name index can't do.

Output: web/public/data/place_index.json
  [{"name": str, "lat": float, "lon": float, "category": str, "address": str|None}, ...]
"""

import sys
from pathlib import Path as _BootstrapPath
sys.path.insert(0, str(_BootstrapPath(__file__).resolve().parent.parent))

import json
from pathlib import Path
from core.osm_extract import query_osm, DEFAULT_BBOX

PIPELINE_DIR = Path(__file__).resolve().parent.parent
WEB_DATA_DIR = PIPELINE_DIR.parent / "web" / "public" / "data"

# Only categories worth surfacing as a "named place" a user might search for
# or expect a map click to resolve to — kept narrow so the index stays small
# and every entry is a real destination, not e.g. a named stretch of curb.
_NAMED_CATEGORIES = {
    "amenity": None,      # any amenity=* with a name (school, library, hospital, restaurant, ...)
    "shop": None,          # any shop=* with a name
    "leisure": {"park", "garden", "nature_reserve", "golf_course", "sports_centre", "stadium", "pitch"},
    "tourism": {"museum", "attraction", "zoo", "gallery"},
    "building": {"apartments"},  # named apartment complexes; addr:housename/operator handled below
}


def _place_category(tags):
    for key, allowed in _NAMED_CATEGORIES.items():
        value = tags.get(key)
        if value and (allowed is None or value in allowed):
            return f"{key}={value}"
    return None


def _place_name(tags):
    return tags.get("name") or tags.get("addr:housename") or tags.get("operator")


def _is_named_place(tags):
    return bool(_place_name(tags)) and _place_category(tags) is not None


def _address(tags):
    housenumber = tags.get("addr:housenumber")
    street = tags.get("addr:street")
    if housenumber and street:
        return f"{housenumber} {street}"
    return None


def build_place_index(bbox=DEFAULT_BBOX):
    elements = query_osm(node_matcher=_is_named_place, way_matcher=_is_named_place, bbox=bbox, cache_key="named_places")

    seen = set()
    places = []
    for element in elements:
        tags = element.get("tags", {})
        name = _place_name(tags)
        lat = element.get("lat")
        lon = element.get("lon")
        if lat is None or lon is None:
            center = element.get("center", {})
            lat, lon = center.get("lat"), center.get("lon")
        if lat is None or lon is None:
            continue

        # Dedupe by (name, ~11m grid cell) — the same physical place is often
        # tagged on both a node (e.g. a sign) and its enclosing way.
        key = (name.strip().lower(), round(lat, 4), round(lon, 4))
        if key in seen:
            continue
        seen.add(key)

        places.append({
            "name": name.strip(),
            "lat": round(float(lat), 6),
            "lon": round(float(lon), 6),
            "category": _place_category(tags),
            "address": _address(tags),
        })

    return places


def export_place_index():
    places = build_place_index()
    WEB_DATA_DIR.mkdir(parents=True, exist_ok=True)
    out_path = WEB_DATA_DIR / "place_index.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(places, f)
    print(f"[OK] Wrote {len(places)} named places to {out_path}")
    return places


if __name__ == "__main__":
    export_place_index()
