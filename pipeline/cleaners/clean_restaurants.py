"""
Clean Restaurant/Bar Access data: fetch restaurants, bars, cafes, and fast
food from OpenStreetMap (via the Overpass API) and count them within each
district as a proxy for dining/nightlife access.

Point-record metric like groceries/healthcare: one row per venue, counted
per district_id by aggregate_by_source(). Also used directly (not through
aggregate_by_source) by core/walk_score.py as one of the amenity categories
in the distance-decay walkability score.
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

_RESTAURANT_NODE_AMENITIES = {"restaurant", "bar", "pub", "cafe", "fast_food"}


def _is_restaurant_node(tags):
    return tags.get("amenity") in _RESTAURANT_NODE_AMENITIES


def _is_restaurant_way(tags):
    return tags.get("amenity") == "restaurant"


def _fetch_nodes():
    """Fetch restaurant/bar/cafe nodes+ways from the local OSM extract (see
    core/osm_extract.py) — replaces the live Overpass query this used to
    make, which was slow/flaky on the public instance."""
    return query_osm(node_matcher=_is_restaurant_node, way_matcher=_is_restaurant_way, relation_matcher=_is_restaurant_way, cache_key="restaurants")


def clean_restaurants(fallback_behavior="exclude_from_scoring_if_geography_fails", city="stpaul", granularity="district"):
    """
    Fetch restaurant/bar/cafe/fast-food data from Overpass API and count
    them within each district or zip (point-in-polygon). city: 'stpaul'
    or 'mpls'. granularity: 'district' or 'zip'.

    Returns:
        DataFrame with columns: node_id, district_id, name
        (one row per venue found inside a zone; aggregate_by_source()
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
        print(f"[WARNING] Overpass API fetch failed ({e}); restaurants will be excluded from scoring")
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
        name = tags.get("name", "Restaurant")

        for district_id, polygon in boundary_map.items():
            if not polygon.contains(point):
                continue
            rows.append({
                "node_id": element.get("id"),
                "district_id": district_id,
                "name": name
            })
            break

    restaurants = pd.DataFrame(rows, columns=["node_id", "district_id", "name"])

    if restaurants.empty and fallback_behavior == "strict":
        raise ValueError("No restaurant/bar data could be joined to districts")

    return restaurants


if __name__ == "__main__":
    cleaned = clean_restaurants()
    print(f"[OK] Cleaned restaurant/bar data: {len(cleaned)} venues")
    if not cleaned.empty:
        totals = cleaned.groupby("district_id").size()
        print("Restaurants/bars by district:")
        print(totals)
