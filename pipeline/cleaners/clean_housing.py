"""
Clean Housing Production data and assign districts via spatial join.
Supports fallback behavior: if geography join fails, excludes from scoring.
"""

import sys
from pathlib import Path as _BootstrapPath
sys.path.insert(0, str(_BootstrapPath(__file__).resolve().parent.parent))


import math
import pandas as pd
import json
from pathlib import Path
from core.load import load_housing, resolve_boundaries
from core.date_window import filter_recent_years
from shapely.geometry import Point, shape

PIPELINE_DIR = Path(__file__).resolve().parent.parent

def _web_mercator_to_lonlat(x, y):
    """Convert EPSG:3857 (Web Mercator) meters to WGS84 lon/lat degrees."""
    origin_shift = 2 * math.pi * 6378137 / 2.0
    lon = (x / origin_shift) * 180.0
    lat = (y / origin_shift) * 180.0
    lat = 180.0 / math.pi * (2 * math.atan(math.exp(lat * math.pi / 180.0)) - math.pi / 2.0)
    return lon, lat

def clean_housing(fallback_behavior="exclude_from_scoring_if_geography_fails", granularity="district"):
    """
    Clean housing data. Map to districts or zips via spatial join of
    coordinates. granularity: 'district' or 'zip'.

    Supports two fallback behaviors:
    - "exclude_from_scoring_if_geography_fails": mark rows with no district_id
    - "strict": raise error if geography fails

    Returns:
        DataFrame with columns: housing_id (or index), district_id (may be NaN), ...
    """
    housing = load_housing()
    # Restricted to a shared recent-years window — see core/date_window.py.
    housing = filter_recent_years(housing, "ProjectPermitIssueDate", epoch_ms=True)
    boundaries = resolve_boundaries(city="stpaul", granularity=granularity)

    # Look for coordinate columns (latitude/longitude or x/y)
    has_lat = any(col.lower() in ["latitude", "lat"] for col in housing.columns)
    has_lon = any(col.lower() in ["longitude", "lon", "longtitude"] for col in housing.columns)
    has_x = "X" in housing.columns
    has_y = "Y" in housing.columns

    lat_col = next((col for col in housing.columns if col.lower() in ["latitude", "lat"]), None)
    lon_col = next((col for col in housing.columns if col.lower() in ["longitude", "lon", "longtitude"]), None)

    if has_lat and has_lon:
        # Filter for valid lat/long
        housing = housing.dropna(subset=[lat_col, lon_col])

        # Build boundary lookup
        boundary_map = {}
        for feature in boundaries["features"]:
            district_id = feature["properties"]["district_id"]
            geom = shape(feature["geometry"])
            boundary_map[district_id] = geom

        # Spatial join
        def find_district(row):
            try:
                point = Point(row[lon_col], row[lat_col])
                for district_id, polygon in boundary_map.items():
                    if polygon.contains(point):
                        return district_id
            except:
                pass
            return None

        housing["district_id"] = housing.apply(find_district, axis=1)
        unmapped = housing["district_id"].isna().sum()
        if unmapped > 0:
            print(f"[WARNING] {unmapped} housing records could not be spatially joined to districts")

    elif has_x and has_y:
        # X/Y are EPSG:3857 (Web Mercator) meters; convert to lon/lat before joining
        housing = housing.dropna(subset=["X", "Y"])

        boundary_map = {}
        for feature in boundaries["features"]:
            district_id = feature["properties"]["district_id"]
            geom = shape(feature["geometry"])
            boundary_map[district_id] = geom

        def find_district(row):
            try:
                lon, lat = _web_mercator_to_lonlat(row["X"], row["Y"])
                point = Point(lon, lat)
                for district_id, polygon in boundary_map.items():
                    if polygon.contains(point):
                        return district_id
            except:
                pass
            return None

        housing["district_id"] = housing.apply(find_district, axis=1)
        unmapped = housing["district_id"].isna().sum()
        if unmapped > 0:
            print(f"[WARNING] {unmapped} housing records could not be spatially joined to districts")

    else:
        # No coordinate columns found
        if fallback_behavior == "strict":
            raise ValueError("Housing data has no valid coordinate columns (latitude/longitude or X/Y)")
        else:
            # Mark all as unmapped; they will be excluded from scoring
            housing["district_id"] = None
            print("[WARNING] Housing data has no coordinate columns; all records marked for exclusion from scoring")

    # Sum actual new dwelling units per project rather than counting rows —
    # a single project permit can cover a multi-unit building, so counting
    # rows undercounts large developments and overcounts single-unit
    # remodel/addition permits equally with new construction. "value" is
    # aggregate.py's convention for a column to sum instead of counting
    # rows; this makes housing_rate_pc comparable with Minneapolis's
    # dwellingUnitsNew-based figure (see clean_housing_mpls.py).
    if "NewDwellingUnits" in housing.columns:
        housing["value"] = pd.to_numeric(housing["NewDwellingUnits"], errors="coerce").fillna(0)

    return housing

if __name__ == "__main__":
    cleaned = clean_housing()
    print(f"[OK] Cleaned housing data: {len(cleaned)} records")
    mapped = cleaned["district_id"].notna().sum()
    unmapped = cleaned["district_id"].isna().sum()
    print(f"  Mapped to districts: {mapped}")
    print(f"  Unmapped (will exclude from scoring): {unmapped}")
    if mapped > 0:
        print(f"  Districts represented: {sorted(cleaned['district_id'].dropna().unique())}")
