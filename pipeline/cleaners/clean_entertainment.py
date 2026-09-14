"""
Clean Entertainment Venue Access data: fetch movie theaters, performing-arts
theaters, museums/galleries, nightlife (nightclubs/casinos), and
recreation-entertainment venues (bowling alleys, arcades) from OpenStreetMap
(via the local OSM extract) and count them within each district as a proxy
for entertainment/culture access.

Point-record metric like groceries/restaurants: one row per venue, counted
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

_ENTERTAINMENT_NODE_AMENITIES = {"cinema", "theatre", "nightclub", "casino", "arts_centre"}
_ENTERTAINMENT_NODE_LEISURE = {"bowling_alley", "amusement_arcade", "adult_gaming_centre", "escape_game"}
_ENTERTAINMENT_NODE_TOURISM = {"museum", "gallery", "aquarium", "zoo", "theme_park"}


def _is_entertainment_node(tags):
    return (
        tags.get("amenity") in _ENTERTAINMENT_NODE_AMENITIES
        or tags.get("leisure") in _ENTERTAINMENT_NODE_LEISURE
        or tags.get("tourism") in _ENTERTAINMENT_NODE_TOURISM
    )


def _is_entertainment_way(tags):
    # Ways (buildings/grounds) are much more common than nodes for
    # museums/theaters/theme parks, matched with "out center" like
    # clean_restaurants.py does for restaurant buildings.
    return (
        tags.get("amenity") in {"cinema", "theatre", "arts_centre"}
        or tags.get("tourism") in _ENTERTAINMENT_NODE_TOURISM
        or tags.get("leisure") == "bowling_alley"
    )


def _fetch_nodes():
    """Fetch entertainment-venue nodes+ways from the local OSM extract (see
    core/osm_extract.py)."""
    return query_osm(node_matcher=_is_entertainment_node, way_matcher=_is_entertainment_way)


def clean_entertainment(fallback_behavior="exclude_from_scoring_if_geography_fails", city="stpaul", granularity="district"):
    """
    Fetch movie theaters, performing-arts venues, museums/galleries,
    nightlife, and entertainment-recreation venues from OpenStreetMap and
    count them within each district or zip (point-in-polygon). city:
    'stpaul' or 'mpls'. granularity: 'district' or 'zip'.

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
        print(f"[WARNING] Overpass API fetch failed ({e}); entertainment venues will be excluded from scoring")
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
        name = tags.get("name", "Entertainment Venue")

        for district_id, polygon in boundary_map.items():
            if not polygon.contains(point):
                continue
            rows.append({
                "node_id": element.get("id"),
                "district_id": district_id,
                "name": name
            })
            break

    entertainment = pd.DataFrame(rows, columns=["node_id", "district_id", "name"])

    if entertainment.empty and fallback_behavior == "strict":
        raise ValueError("No entertainment venue data could be joined to districts")

    return entertainment


if __name__ == "__main__":
    cleaned = clean_entertainment()
    print(f"[OK] Cleaned entertainment venue data: {len(cleaned)} venues")
    if not cleaned.empty:
        totals = cleaned.groupby("district_id").size()
        print("Entertainment venues by district:")
        print(totals)
