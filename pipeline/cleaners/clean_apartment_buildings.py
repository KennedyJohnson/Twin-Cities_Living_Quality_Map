"""
Clean Apartment Building locations: fetch real apartment buildings from
OpenStreetMap (building=apartments) via the Overpass API, for the "Find Your
Match" feature to recommend actual buildings instead of whole districts.

Point-record source like clean_schools.py: one row per building, assigned to
a district via point-in-polygon. Unlike clean_schools.py this is NOT wired
into sources.json / aggregate_by_source() — it isn't a health-score input,
just location data that gets its own 1-mile-radius score computed separately
(see core/radius_score.py) and shipped to the frontend as
web/public/data/apartment_buildings_{city}.json (see build.py).
"""

import sys
from pathlib import Path as _BootstrapPath
sys.path.insert(0, str(_BootstrapPath(__file__).resolve().parent.parent))


import math
import re
import time
from pathlib import Path

import pandas as pd
from core.http_cache import cached_get, LONG_TTL_SECONDS
from core.osm_extract import query_osm
from core.load import resolve_boundaries
from shapely.geometry import Point, shape

PIPELINE_DIR = Path(__file__).resolve().parent.parent
NOMINATIM_REVERSE_URL = "https://nominatim.openstreetmap.org/reverse"

# Twin Cities bounding box (south, west, north, east) - covers both
# St. Paul and Minneapolis, same box clean_schools.py uses.
BBOX = "44.85, -93.35, 45.05, -92.95"


def _is_apartment_building(tags):
    return tags.get("building") == "apartments"


# Many apartment buildings aren't tagged building=apartments: bulk-imported
# footprints are building=yes/residential (93% of buildings in Highland Park,
# e.g.). Also count (a) large building=residential footprints (a single
# house is well under 600 m^2 — explicitly tagged houses/detached run
# ~75-280 m^2) and (b) generic buildings named like an apartment building
# with no tag suggesting a shop/amenity/office use.
APARTMENT_MIN_RESIDENTIAL_M2 = 600
_APARTMENT_NAME_RE = re.compile(
    r"(apartments?|apts|flats|lofts|residences|senior (living|housing)|townhomes)", re.I)
_NON_RESIDENTIAL_KEYS = {"amenity", "shop", "office", "craft", "tourism", "healthcare", "leisure"}


def _is_apartment_way_candidate(tags):
    b = tags.get("building")
    if b == "apartments":
        return True
    if b not in ("yes", "residential") or _NON_RESIDENTIAL_KEYS & tags.keys():
        return False
    return b == "residential" or bool(_APARTMENT_NAME_RE.search(tags.get("name", "")))


def _footprint_m2(coords):
    lat0 = math.radians(coords[0][0])
    pts = [(lon * 111320 * math.cos(lat0), lat * 110540) for lat, lon in coords]
    return abs(sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(pts, pts[1:] + pts[:1]))) / 2


def _is_apartment_way(tags, coords):
    """Geometry-stage check: an unnamed building=residential only counts when
    its footprint is apartment-sized."""
    if tags.get("building") == "apartments" or _APARTMENT_NAME_RE.search(tags.get("name", "")):
        return True
    return _footprint_m2(coords) >= APARTMENT_MIN_RESIDENTIAL_M2


def _fetch_nodes():
    """Fetch apartment-building nodes/ways from the local OSM extract (see
    core/osm_extract.py) — replaces the live Overpass query this used to
    make, which was slow/flaky on the public instance."""
    return query_osm(node_matcher=_is_apartment_building, way_matcher=_is_apartment_way_candidate,
                     way_geometry_filter=_is_apartment_way, relation_matcher=_is_apartment_building,
                     cache_key="apartment_buildings")


def _building_name_address(tags):
    name = tags.get("name")
    if name:
        name = name.strip()
    housenumber = tags.get("addr:housenumber")
    street = tags.get("addr:street")
    address = f"{housenumber} {street}".strip() if housenumber and street else None
    if not name:
        name = address if address else "Apartment Building"
    return name, address


def _reverse_geocode_address(lat, lon):
    """Look up a street address for a building OSM tagged with neither a
    name nor addr:housenumber/addr:street, via Nominatim's free reverse
    endpoint. Nominatim's usage policy caps public requests at 1/sec, so
    callers must sleep between calls; results are cached on disk (see
    core/http_cache) so re-running a build within the TTL costs nothing."""
    headers = {"User-Agent": "StPaulNeighborhoodHealth/1.0 (data pipeline)"}
    params = {"lat": lat, "lon": lon, "format": "jsonv2", "zoom": 18, "addressdetails": 1}
    try:
        response = cached_get(NOMINATIM_REVERSE_URL, headers=headers, params=params, timeout=15, ttl_seconds=LONG_TTL_SECONDS)
        response.raise_for_status()
        addr = response.json().get("address", {})
    except Exception:
        return None

    # A bare road name with no house number (Nominatim falls back to this
    # when it can't pin down the exact parcel) isn't a usable address — it
    # doesn't identify this building any more specifically than "somewhere
    # on this street," but if accepted here it gets stored as both the
    # row's address AND name, so the frontend ends up displaying e.g. just
    # "Saunders Avenue" as if it were the building's actual name/address,
    # complete with a bogus "View reviews on Google" link. Treat it the same
    # as no result at all so _fill_missing_addresses drops the row instead.
    house_number = addr.get("house_number")
    road = addr.get("road")
    if road and house_number:
        return f"{house_number} {road}"
    return None


def _fill_missing_addresses(rows):
    """Reverse-geocode buildings OSM left both unnamed and address-less, so
    they show up in the UI/listing links as something more specific than
    a generic "Apartment Building" placeholder. Buildings that still have
    neither a real name nor a full house-number address afterward are
    dropped entirely — see _reverse_geocode_address's docstring — rather
    than shown with a misleading bare-street-name label."""
    missing = [row for row in rows if row["address"] is None and row["name"] == "Apartment Building"]
    if missing:
        print(f"[INFO] Reverse-geocoding {len(missing)} unnamed/unaddressed buildings via Nominatim...")
        for i, row in enumerate(missing):
            address = _reverse_geocode_address(row["lat"], row["lon"])
            if address:
                row["address"] = address
                row["name"] = address
            time.sleep(1)  # Nominatim's public-instance usage policy: max 1 req/sec
            if (i + 1) % 50 == 0:
                print(f"  ...{i + 1}/{len(missing)}")

    unresolved = [row for row in rows if row["address"] is None and row["name"] == "Apartment Building"]
    if unresolved:
        print(f"[INFO] Dropping {len(unresolved)} buildings with no name and no resolvable street address")
        unresolved_ids = {row["id"] for row in unresolved}
        rows[:] = [row for row in rows if row["id"] not in unresolved_ids]


def clean_apartment_buildings(fallback_behavior="exclude_from_scoring_if_geography_fails", city="stpaul"):
    """
    Fetch apartment-building locations from Overpass and assign each to a
    district via point-in-polygon. city: 'stpaul' or 'mpls'.

    Returns:
        DataFrame with columns: id, name, address, lat, lon, district_id
    """
    boundaries = resolve_boundaries(city=city, granularity="district")

    boundary_map = {}
    for feature in boundaries["features"]:
        district_id = feature["properties"]["district_id"]
        boundary_map[district_id] = shape(feature["geometry"])

    columns = ["id", "name", "address", "lat", "lon", "district_id"]

    try:
        elements = _fetch_nodes()
    except Exception as e:
        if fallback_behavior == "strict":
            raise
        print(f"[WARNING] Overpass API fetch failed ({e}); apartment buildings unavailable for {city}")
        return pd.DataFrame(columns=columns)

    rows = []
    seen_ids = set()
    for element in elements:
        lat = element.get("lat")
        lon = element.get("lon")
        if lat is None or lon is None:
            center = element.get("center")
            if not center:
                continue
            lat = center.get("lat")
            lon = center.get("lon")
        if lat is None or lon is None:
            continue

        point = Point(lon, lat)
        tags = element.get("tags", {})
        name, address = _building_name_address(tags)

        for district_id, polygon in boundary_map.items():
            if not polygon.contains(point):
                continue
            osm_id = f"{element.get('type', 'way')}/{element.get('id')}"
            if osm_id in seen_ids:
                break
            seen_ids.add(osm_id)
            rows.append({
                "id": osm_id,
                "name": name,
                "address": address,
                "lat": float(lat),
                "lon": float(lon),
                "district_id": district_id,
            })
            break

    _fill_missing_addresses(rows)

    buildings = pd.DataFrame(rows, columns=columns)

    if buildings.empty and fallback_behavior == "strict":
        raise ValueError("No apartment building data could be joined to districts")

    return buildings


if __name__ == "__main__":
    for city in ("stpaul", "mpls"):
        cleaned = clean_apartment_buildings(city=city)
        print(f"[OK] {city}: {len(cleaned)} apartment buildings")
        if not cleaned.empty:
            print(cleaned.groupby("district_id").size())
