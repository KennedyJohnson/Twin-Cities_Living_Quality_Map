"""
Clean Transit Accessibility data: fetch bus stops, light rail/train stations,
and transit platforms from OpenStreetMap (via the Overpass API) and count
stops within each district as a proxy for public transit availability
(Metro Transit buses, METRO light rail lines, etc.).

Point-record metric like crime/permits/requests: one row per stop, counted
per district_id by aggregate_by_source().
"""

import sys
from pathlib import Path as _BootstrapPath
sys.path.insert(0, str(_BootstrapPath(__file__).resolve().parent.parent))


from core.osm_extract import query_osm
import pandas as pd
from pathlib import Path
from core.load import resolve_boundaries
from shapely.geometry import Point, shape

PIPELINE_DIR = Path(__file__).resolve().parent.parent

_TRANSIT_RAILWAY_TAGS = {"station", "halt", "tram_stop"}

# Rail (light rail/train stations, tram stops) counts for more than a single
# bus stop toward the transit metric. METRO Blue/Green line stations average
# roughly 1,000-3,000+ weekday boardings vs. single/low-double-digit boardings
# at a typical local bus stop, and offer frequent (10-15 min) all-day service
# plus regional reach (airport, downtown, U of M) that local bus routes
# usually don't match. 3x reflects that gap without letting one station
# dominate a district that only has a couple of rail stops.
_MODE_WEIGHT = {"rail": 3.0, "bus": 1.0}


def _is_transit_node(tags):
    if tags.get("highway") == "bus_stop":
        return True
    if tags.get("public_transport") in ("platform", "stop_position"):
        return True
    if tags.get("railway") in _TRANSIT_RAILWAY_TAGS:
        return True
    if tags.get("station") == "light_rail":
        return True
    return False


def _fetch_nodes():
    """Fetch transit stop/station nodes from the local OSM extract (see
    core/osm_extract.py) — replaces the live Overpass query this used to
    make, which was slow/flaky on the public instance."""
    return query_osm(node_matcher=_is_transit_node, cache_key="transit")

def clean_transit(fallback_behavior="exclude_from_scoring_if_geography_fails", city="stpaul", granularity="district"):
    """
    Fetch transit stop/station data from Overpass API and count stops
    within each district or zip (point-in-polygon). city: 'stpaul' or
    'mpls'. granularity: 'district' or 'zip'.

    Returns:
        DataFrame with columns: node_id, district_id, mode, value
        (one row per stop found inside a zone; aggregate_by_source()
        sums the "value" column per district_id, which weights rail
        stops higher than bus stops via _MODE_WEIGHT)
    """
    boundaries = resolve_boundaries(city=city, granularity=granularity)

    boundary_map = {}
    for feature in boundaries["features"]:
        district_id = feature["properties"]["district_id"]
        boundary_map[district_id] = shape(feature["geometry"])

    try:
        elements = _fetch_nodes()
    except Exception as e:
        if fallback_behavior == "strict":
            raise
        print(f"[WARNING] Overpass API fetch failed ({e}); transit will be excluded from scoring")
        return pd.DataFrame(columns=["node_id", "district_id", "mode", "value"])

    rows = []
    for element in elements:
        lat = element.get("lat")
        lon = element.get("lon")
        if lat is None or lon is None:
            continue
        point = Point(lon, lat)

        tags = element.get("tags", {})
        if tags.get("railway") in ("station", "halt", "tram_stop") or tags.get("station") == "light_rail":
            mode = "rail"
        else:
            mode = "bus"

        for district_id, polygon in boundary_map.items():
            if not polygon.contains(point):
                continue
            rows.append({
                "node_id": element.get("id"),
                "district_id": district_id,
                "mode": mode,
                "value": _MODE_WEIGHT[mode]
            })
            break

    transit = pd.DataFrame(rows, columns=["node_id", "district_id", "mode", "value"])

    if transit.empty and fallback_behavior == "strict":
        raise ValueError("No transit data could be joined to districts")

    return transit

if __name__ == "__main__":
    cleaned = clean_transit()
    print(f"[OK] Cleaned transit data: {len(cleaned)} stops/stations")
    if not cleaned.empty:
        totals = cleaned.groupby("district_id").size()
        print("Transit stops by district:")
        print(totals)
        print("\nBy mode:")
        print(cleaned["mode"].value_counts())
