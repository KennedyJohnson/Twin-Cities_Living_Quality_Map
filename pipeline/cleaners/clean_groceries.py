"""
Clean Grocery Store Access data: fetch supermarkets and grocery stores from
OpenStreetMap (via the Overpass API) and count them within each district as
a proxy for food access.

Point-record metric like transit/schools: one row per store, counted per
district_id by aggregate_by_source().
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


def _is_grocery_node(tags):
    return tags.get("shop") in ("supermarket", "grocery")


def _is_grocery_way(tags):
    return tags.get("shop") == "supermarket"


def _fetch_nodes():
    """Fetch grocery/supermarket nodes+ways from the local OSM extract (see
    core/osm_extract.py) — replaces the live Overpass query this used to
    make, which was slow/flaky on the public instance."""
    return query_osm(node_matcher=_is_grocery_node, way_matcher=_is_grocery_way, cache_key="groceries")


def clean_groceries(fallback_behavior="exclude_from_scoring_if_geography_fails", city="stpaul", granularity="district"):
    """
    Fetch grocery store/supermarket data from Overpass API and count
    them within each district or zip (point-in-polygon). city: 'stpaul'
    or 'mpls'. granularity: 'district' or 'zip'.

    Returns:
        DataFrame with columns: node_id, district_id, name
        (one row per store found inside a zone; aggregate_by_source()
        counts rows per district_id since there is no "value" column)
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
        print(f"[WARNING] Overpass API fetch failed ({e}); groceries will be excluded from scoring")
        return pd.DataFrame(columns=["node_id", "district_id", "name"])

    rows = []
    for element in elements:
        # ways queried with "out center" carry a "center" dict instead of lat/lon
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
        name = tags.get("name", "Grocery Store")

        for district_id, polygon in boundary_map.items():
            if not polygon.contains(point):
                continue
            rows.append({
                "node_id": element.get("id"),
                "district_id": district_id,
                "name": name
            })
            break

    groceries = pd.DataFrame(rows, columns=["node_id", "district_id", "name"])

    if groceries.empty and fallback_behavior == "strict":
        raise ValueError("No grocery store data could be joined to districts")

    return groceries


if __name__ == "__main__":
    cleaned = clean_groceries()
    print(f"[OK] Cleaned grocery store data: {len(cleaned)} stores")
    if not cleaned.empty:
        totals = cleaned.groupby("district_id").size()
        print("Grocery stores by district:")
        print(totals)
