"""
Clean Healthcare Access data: fetch hospitals, clinics, doctors' offices,
and pharmacies from OpenStreetMap (via the Overpass API) and count them
within each district as a proxy for access to healthcare.

Point-record metric like groceries/schools: one row per facility, counted
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

_HEALTHCARE_AMENITIES = {"hospital", "clinic", "doctors", "pharmacy"}
_HEALTHCARE_TAGS = {"hospital", "clinic", "doctor", "pharmacy"}


def _is_healthcare(tags):
    return tags.get("amenity") in _HEALTHCARE_AMENITIES or tags.get("healthcare") in _HEALTHCARE_TAGS


def _fetch_nodes():
    """Fetch healthcare facility nodes+ways from the local OSM extract (see
    core/osm_extract.py) — replaces the live Overpass query this used to
    make, which was slow/flaky on the public instance."""
    return query_osm(node_matcher=_is_healthcare, way_matcher=_is_healthcare, relation_matcher=_is_healthcare, cache_key="healthcare")


def clean_healthcare(fallback_behavior="exclude_from_scoring_if_geography_fails", city="stpaul", granularity="district"):
    """
    Fetch healthcare facility data from Overpass API and count them within
    each district or zip (point-in-polygon). city: 'stpaul' or 'mpls'.
    granularity: 'district' or 'zip'.

    Returns:
        DataFrame with columns: node_id, district_id, kind
        (one row per facility found inside a zone; aggregate_by_source()
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
        print(f"[WARNING] Overpass API fetch failed ({e}); healthcare will be excluded from scoring")
        return pd.DataFrame(columns=["node_id", "district_id", "kind"])

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
        kind = tags.get("amenity") or tags.get("healthcare") or "healthcare"

        for district_id, polygon in boundary_map.items():
            if not polygon.contains(point):
                continue
            rows.append({
                "node_id": element.get("id"),
                "district_id": district_id,
                "kind": kind
            })
            break

    healthcare = pd.DataFrame(rows, columns=["node_id", "district_id", "kind"])

    if healthcare.empty and fallback_behavior == "strict":
        raise ValueError("No healthcare facility data could be joined to districts")

    return healthcare


if __name__ == "__main__":
    cleaned = clean_healthcare()
    print(f"[OK] Cleaned healthcare facility data: {len(cleaned)} facilities")
    if not cleaned.empty:
        totals = cleaned.groupby("district_id").size()
        print("Healthcare facilities by district:")
        print(totals)
        print("\nBy kind:")
        print(cleaned["kind"].value_counts())
