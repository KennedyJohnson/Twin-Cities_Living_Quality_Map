"""
Clean Walkability data: fetch trails/pedestrian paths from OpenStreetMap
(via the Overpass API) and compute trail length (km) within each district.

Unlike the point-record sources (crime, permits, requests), walkability is a
line-geometry metric: instead of counting incidents, we sum the length of
each trail/path segment that falls inside a district's boundary. Output rows
are one-per-(way, district) with a "value" column in km, which
aggregate_by_source() sums per district_id.
"""

import sys
from pathlib import Path as _BootstrapPath
sys.path.insert(0, str(_BootstrapPath(__file__).resolve().parent.parent))


import json
from core.osm_extract import query_osm, DEFAULT_BBOX
import pandas as pd
from pathlib import Path
from core.load import resolve_boundaries
from shapely.geometry import LineString, shape

PIPELINE_DIR = Path(__file__).resolve().parent.parent

# Twin Cities bounding box (south, west, north, east) - covers both St. Paul
# and Minneapolis so this loader works for either city's districts, plus
# enough margin for the 1-mile radius click feature and for regional trails
# (Gateway State Trail, Luce Line, Mississippi River Trail) that extend past
# the two cities' limits. Minneapolis' northern edge alone reaches ~45.0512,
# so the old 45.05 cap was clipping the city itself. Matches
# core/osm_extract.py's DEFAULT_BBOX.
BBOX = DEFAULT_BBOX

_TRAIL_HIGHWAY_TAGS = {"path", "footway", "cycleway", "pedestrian", "track", "bridleway", "steps"}


def _is_trail_way(tags):
    highway = tags.get("highway")
    if highway in _TRAIL_HIGHWAY_TAGS:
        return True
    if highway and (tags.get("bicycle") == "designated" or tags.get("foot") == "designated"):
        return True
    if tags.get("leisure") == "track" and tags.get("area") != "yes":
        return True
    if tags.get("leisure") == "park":
        return True
    return False

# Sidewalks/crossings are tagged highway=footway too, but they aren't
# recreational trails — they're the pedestrian shoulder of a regular street.
# Left unfiltered, they outnumber real trails ~5-to-1 in this metro (dense
# urban sidewalk grid), so they were crowding out actual trails/paths under
# export_points.MAX_WAYS's random sample and inflating trail_km_pc in the
# health score. Excluded by footway subtag; every other highway type in the
# query above (path/cycleway/pedestrian/track/bridleway/steps) is kept as-is.
_NON_TRAIL_FOOTWAY_SUBTAGS = {"sidewalk", "crossing", "traffic_island", "access_aisle", "link"}

# Natural/recreational surfaces that mark an unsubtagged footway as a real
# trail rather than a paved city sidewalk.
_TRAIL_SURFACES = {"unpaved", "gravel", "dirt", "ground", "fine_gravel", "wood", "grass", "sand", "woodchips"}


def _is_real_trail(element):
    tags = element.get("tags", {})
    if tags.get("highway") != "footway":
        return True
    if tags.get("footway") in _NON_TRAIL_FOOTWAY_SUBTAGS:
        return False
    if tags.get("is_sidepath") == "yes":
        return False
    # An unsubtagged footway with no name and no trail-like surface is almost
    # always a plain sidewalk that OSM mappers didn't bother subtagging.
    if not tags.get("footway") and not tags.get("name") and tags.get("surface") not in _TRAIL_SURFACES:
        return False
    return True


def _fetch_ways():
    """Fetch trail/path ways (with full geometry) from the local OSM
    extract (see core/osm_extract.py) — replaces the live Overpass query
    this used to make, which was slow/flaky on the public instance."""
    elements = query_osm(way_matcher=_is_trail_way, want_way_geometry=True, bbox=BBOX, cache_key="trails")
    return [e for e in elements if _is_real_trail(e)]

def clean_walkability(fallback_behavior="exclude_from_scoring_if_geography_fails", city="stpaul", granularity="district"):
    """
    Fetch trail/path data from Overpass API and compute length (km) within
    each district or zip via line-polygon intersection. city: 'stpaul' or
    'mpls'. granularity: 'district' or 'zip'.

    Returns:
        DataFrame with columns: way_id, district_id, value (length_km)
    """
    boundaries = resolve_boundaries(city=city, granularity=granularity)

    boundary_map = {}
    for feature in boundaries["features"]:
        district_id = feature["properties"]["district_id"]
        boundary_map[district_id] = shape(feature["geometry"])

    try:
        elements = _fetch_ways()
    except Exception as e:
        if fallback_behavior == "strict":
            raise
        print(f"[WARNING] Overpass API fetch failed ({e}); walkability will be excluded from scoring")
        return pd.DataFrame(columns=["way_id", "district_id", "value"])

    rows = []
    for element in elements:
        geometry = element.get("geometry")
        if not geometry or len(geometry) < 2:
            continue

        try:
            line = LineString([(pt["lon"], pt["lat"]) for pt in geometry])
        except Exception:
            continue

        for district_id, polygon in boundary_map.items():
            if not line.intersects(polygon):
                continue
            clipped = line.intersection(polygon)
            if clipped.is_empty:
                continue
            # Approximate degrees->km conversion (good enough at this latitude)
            length_km = clipped.length * 111.0
            if length_km <= 0:
                continue
            rows.append({
                "way_id": element.get("id"),
                "district_id": district_id,
                "value": length_km
            })

    walkability = pd.DataFrame(rows, columns=["way_id", "district_id", "value"])

    if walkability.empty and fallback_behavior == "strict":
        raise ValueError("No walkability data could be joined to districts")

    return walkability

if __name__ == "__main__":
    cleaned = clean_walkability()
    print(f"[OK] Cleaned walkability data: {len(cleaned)} way/district segments")
    if not cleaned.empty:
        totals = cleaned.groupby("district_id")["value"].sum().round(2)
        print("Trail km by district:")
        print(totals)
