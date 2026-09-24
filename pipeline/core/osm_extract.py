"""
Local OSM data source: downloads a Geofabrik Minnesota .pbf extract once and
answers the same kind of node/way tag queries the pipeline used to send to
the public Overpass API, but reading it locally instead.

Why this exists: the public Overpass instance (overpass-api.de) was
frequently overloaded/unreachable — a full pipeline build could stall for
25-55+ minutes waiting out repeated ~120s connection timeouts across the
~8 OSM-based sources (schools, groceries, restaurants, healthcare, transit,
trails, apartment buildings, and the walk-score street network), each
queried at both district and zip granularity. core/overpass.py's
mirror-fallback helper mitigated that; this module removes the live network
dependency entirely for these sources. Every query answered here is local
CPU work over an already-downloaded file, with zero timeout risk.

The .pbf is re-downloaded when it's older than EXTRACT_MAX_AGE_DAYS (30 days —
building/amenity/trail data doesn't meaningfully change week to week, so this
is intentionally slower than the project's weekly refresh cadence, see
.github/workflows/refresh-data.yml) so a scheduled run doesn't re-fetch
270+ MB every single week.

Returns element lists shaped like Overpass's `elements` array (the same
shape core/overpass.py's fetch_overpass returns), so each cleaner's
existing post-processing (tag inspection, _is_real_trail filtering, etc.)
works unchanged — only the fetch call itself changes.
"""

import sys
from pathlib import Path as _BootstrapPath
sys.path.insert(0, str(_BootstrapPath(__file__).resolve().parent.parent))


import json
import time
from pathlib import Path

import requests
import osmium

CACHE_DIR = Path(__file__).parent / ".cache"
EXTRACT_PATH = CACHE_DIR / "minnesota-latest.osm.pbf"
EXTRACT_URL = "https://download.geofabrik.de/north-america/us/minnesota-latest.osm.pbf"
EXTRACT_MAX_AGE_DAYS = 30  # OSM building/amenity/trail data barely changes week to week;
# monthly keeps the weekly pipeline refresh from re-downloading ~285MB every single run

# Each query_osm() call re-scans the entire ~285MB extract (a full
# osmium.apply_file pass), which takes minutes even though it's pure local
# CPU work with no network risk. Cleaners call query_osm() once per city
# (and walkability/walk_score once per granularity too) with the exact same
# matcher/bbox each time — the boundary/district filtering that actually
# varies by city happens downstream on the returned elements, not in the
# query itself. So the raw elements list is cacheable per (cache_key, bbox)
# to disk, keyed off the extract's own mtime: a cache entry is valid as long
# as it's newer than the .pbf it was built from, which naturally invalidates
# every cache entry the moment ensure_extract_downloaded() pulls a fresh
# extract (weekly, or whenever the local copy is stale/missing).
QUERY_CACHE_DIR = CACHE_DIR / "query_cache"

# Twin Cities bounding box (south, west, north, east) — matches the bbox
# every OSM-based cleaner used in its Overpass query, plus the 1-mile-radius
# margin clean_walkability.py already widened to.
DEFAULT_BBOX = (44.78, -93.50, 45.15, -92.80)


def ensure_extract_downloaded():
    """Download the Minnesota .pbf if missing or older than
    EXTRACT_MAX_AGE_DAYS. Returns the local file path."""
    if EXTRACT_PATH.exists():
        age_days = (time.time() - EXTRACT_PATH.stat().st_mtime) / 86400
        if age_days < EXTRACT_MAX_AGE_DAYS:
            return EXTRACT_PATH

    print(f"[INFO] Downloading Minnesota OSM extract from {EXTRACT_URL} "
          f"(one-time/weekly ~270MB download, replaces live Overpass calls)...")
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    tmp_path = EXTRACT_PATH.with_suffix(".pbf.tmp")
    with requests.get(EXTRACT_URL, stream=True, timeout=300) as response:
        response.raise_for_status()
        with open(tmp_path, "wb") as f:
            for chunk in response.iter_content(chunk_size=1024 * 1024):
                f.write(chunk)
    tmp_path.replace(EXTRACT_PATH)
    print(f"[OK] Downloaded OSM extract to {EXTRACT_PATH} "
          f"({EXTRACT_PATH.stat().st_size / 1e6:.0f} MB)")
    return EXTRACT_PATH


def _in_bbox(lat, lon, bbox):
    south, west, north, east = bbox
    return south <= lat <= north and west <= lon <= east


class _ElementCollector(osmium.SimpleHandler):
    """Collects nodes/ways matching caller-supplied tag predicates into
    Overpass-`elements`-shaped dicts."""

    def __init__(self, node_matcher, way_matcher, want_way_geometry, bbox, way_geometry_filter=None,
                 relation_member_ways=None):
        super().__init__()
        self.way_geometry_filter = way_geometry_filter
        # way id -> coords, for outer ways of matched multipolygon relations
        # (see _RelationScanner); filled regardless of way_matcher.
        self.relation_member_ways = relation_member_ways or set()
        self.member_coords = {}
        self.node_matcher = node_matcher
        self.way_matcher = way_matcher
        self.want_way_geometry = want_way_geometry
        self.bbox = bbox
        self.elements = []

    def node(self, n):
        if self.node_matcher is None or not n.location.valid():
            return
        lat, lon = n.location.lat, n.location.lon
        if not _in_bbox(lat, lon, self.bbox):
            return
        tags = dict(n.tags)
        if self.node_matcher(tags):
            self.elements.append({"type": "node", "id": n.id, "lat": lat, "lon": lon, "tags": tags})

    def way(self, w):
        if w.id in self.relation_member_ways:
            try:
                self.member_coords[w.id] = [(nd.location.lat, nd.location.lon) for nd in w.nodes if nd.location.valid()]
            except osmium.InvalidLocationError:
                pass
        if self.way_matcher is None:
            return
        tags = dict(w.tags)
        if not self.way_matcher(tags):
            return
        try:
            coords = [(nd.location.lat, nd.location.lon) for nd in w.nodes if nd.location.valid()]
        except osmium.InvalidLocationError:
            return
        if not coords or not any(_in_bbox(lat, lon, self.bbox) for lat, lon in coords):
            return
        if self.way_geometry_filter and not self.way_geometry_filter(tags, coords):
            return

        element = {"type": "way", "id": w.id, "tags": tags}
        if self.want_way_geometry:
            element["geometry"] = [{"lat": lat, "lon": lon} for lat, lon in coords]
        else:
            element["center"] = {
                "lat": sum(c[0] for c in coords) / len(coords),
                "lon": sum(c[1] for c in coords) / len(coords),
            }
        self.elements.append(element)


class _RelationScanner(osmium.SimpleHandler):
    """First pass for relation_matcher: finds multipolygon relations whose
    tags match and records their outer member way ids. Relations come after
    ways in a .pbf, so their geometry has to be picked up in a second pass
    (_ElementCollector.member_coords)."""

    def __init__(self, relation_matcher):
        super().__init__()
        self.relation_matcher = relation_matcher
        self.relations = []  # (id, tags, [outer way ids])

    def relation(self, r):
        tags = dict(r.tags)
        if tags.get("type") != "multipolygon" or not self.relation_matcher(tags):
            return
        outer = [m.ref for m in r.members if m.type == "w" and m.role in ("outer", "")]
        if outer:
            self.relations.append((r.id, tags, outer))


def _query_cache_path(cache_key):
    safe_key = "".join(c if c.isalnum() or c in "-_" else "_" for c in cache_key)
    # "_r" suffix: caches written before relation support must not be reused.
    return QUERY_CACHE_DIR / f"{safe_key}_r.json"


def query_osm(node_matcher=None, way_matcher=None, want_way_geometry=False, bbox=DEFAULT_BBOX, cache_key=None,
              way_geometry_filter=None, relation_matcher=None):
    """
    Query the local OSM extract for nodes/ways matching the given
    predicates, restricted to bbox.

    Args:
        node_matcher: callable(tags: dict) -> bool, or None to skip nodes
        way_matcher: callable(tags: dict) -> bool, or None to skip ways
        want_way_geometry: if True, matched ways carry a full "geometry"
            list of {"lat", "lon"} points (like Overpass's "out geom;");
            if False, they carry a single averaged "center" point (like
            Overpass's "out center;")
        bbox: (south, west, north, east)
        way_geometry_filter: optional callable(tags, coords) -> bool, where
            coords is the way's [(lat, lon), ...]; runs after way_matcher so
            a caller can filter on shape (e.g. footprint area) without
            keeping every matched way's full geometry
        relation_matcher: optional callable(tags) -> bool for multipolygon
            relations (places mapped as multi-part areas, e.g. some school
            campuses and hospitals, which nodes/ways alone miss). Matches are
            returned as {"type": "relation", "id", "tags", "center"}, center
            being the mean of the outer ways' points; needs an extra
            relations-only pass over the extract
        cache_key: if given, cache the resulting elements list to disk under
            this key (see QUERY_CACHE_DIR above) so a repeat call — e.g. the
            same cleaner running once per city — reuses it instead of
            re-scanning the whole extract. Pass a name unique to the
            matcher/bbox combination (each cleaner uses its own).

    Returns:
        list of element dicts, shaped like Overpass's `elements` array —
        {"type": "node", "id", "lat", "lon", "tags"} or
        {"type": "way", "id", "tags", "center"|"geometry"}
    """
    extract_path = ensure_extract_downloaded()

    if cache_key:
        cache_path = _query_cache_path(cache_key)
        if cache_path.exists() and cache_path.stat().st_mtime >= extract_path.stat().st_mtime:
            with open(cache_path, "r", encoding="utf-8") as f:
                return json.load(f)

    relations = []
    if relation_matcher is not None:
        scanner = _RelationScanner(relation_matcher)
        scanner.apply_file(str(extract_path))
        relations = scanner.relations

    member_ways = {wid for _, _, outer in relations for wid in outer}
    collector = _ElementCollector(node_matcher, way_matcher, want_way_geometry, bbox, way_geometry_filter,
                                  relation_member_ways=member_ways)
    collector.apply_file(str(extract_path), locations=True)
    elements = collector.elements

    for rel_id, tags, outer in relations:
        coords = [c for wid in outer for c in collector.member_coords.get(wid, [])]
        if not coords or not any(_in_bbox(lat, lon, bbox) for lat, lon in coords):
            continue
        elements.append({
            "type": "relation", "id": rel_id, "tags": tags,
            "center": {"lat": sum(c[0] for c in coords) / len(coords),
                       "lon": sum(c[1] for c in coords) / len(coords)},
        })

    if cache_key:
        QUERY_CACHE_DIR.mkdir(parents=True, exist_ok=True)
        cache_path = _query_cache_path(cache_key)
        tmp_path = cache_path.with_suffix(".json.tmp")
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(elements, f)
        tmp_path.replace(cache_path)

    return elements
