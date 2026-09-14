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


import time
from pathlib import Path

import pandas as pd
from core.http_cache import cached_get, cached_post, LONG_TTL_SECONDS
from core.load import resolve_boundaries
from shapely.geometry import Point, shape

PIPELINE_DIR = Path(__file__).resolve().parent.parent
OVERPASS_URL = "https://overpass-api.de/api/interpreter"
NOMINATIM_REVERSE_URL = "https://nominatim.openstreetmap.org/reverse"

# Twin Cities bounding box (south, west, north, east) - covers both
# St. Paul and Minneapolis, same box clean_schools.py uses.
BBOX = "44.85, -93.35, 45.05, -92.95"

OVERPASS_QUERY = f"""
[out:json][timeout:90];
(
  way["building"="apartments"]({BBOX});
  node["building"="apartments"]({BBOX});
);
out center;
"""


def _fetch_nodes(max_retries=3):
    """Query Overpass for apartment-building ways/nodes. Retries with
    backoff on the public instance's occasional 504/429s, same pattern as
    clean_schools.py / clean_transit.py."""
    headers = {
        "User-Agent": "StPaulNeighborhoodHealth/1.0 (data pipeline)",
        "Accept": "*/*"
    }
    last_error = None
    for attempt in range(max_retries):
        try:
            response = cached_post(OVERPASS_URL, data={"data": OVERPASS_QUERY}, headers=headers, timeout=150, ttl_seconds=LONG_TTL_SECONDS)
            response.raise_for_status()
            return response.json()["elements"]
        except Exception as e:
            last_error = e
            if attempt < max_retries - 1:
                time.sleep(15 * (attempt + 1))
    raise last_error


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

    house_number = addr.get("house_number")
    road = addr.get("road")
    if road and house_number:
        return f"{house_number} {road}"
    if road:
        return road
    return None


def _fill_missing_addresses(rows):
    """Reverse-geocode buildings OSM left both unnamed and address-less, so
    they show up in the UI/listing links as something more specific than
    a generic "Apartment Building" placeholder."""
    missing = [row for row in rows if row["address"] is None and row["name"] == "Apartment Building"]
    if not missing:
        return
    print(f"[INFO] Reverse-geocoding {len(missing)} unnamed/unaddressed buildings via Nominatim...")
    for i, row in enumerate(missing):
        address = _reverse_geocode_address(row["lat"], row["lon"])
        if address:
            row["address"] = address
            row["name"] = address
        time.sleep(1)  # Nominatim's public-instance usage policy: max 1 req/sec
        if (i + 1) % 50 == 0:
            print(f"  ...{i + 1}/{len(missing)}")


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
