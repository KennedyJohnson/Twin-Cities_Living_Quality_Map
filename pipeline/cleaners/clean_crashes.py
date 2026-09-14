"""
Fetch pedestrian/cyclist ("vulnerable road user") crash locations statewide
from MnDOT/MnDPS's ArcGIS FeatureServer (2016-2021) and count them within
each district, as a Safety signal — more crashes lowers Safety.

Source: https://www.arcgis.com/home/item.html?id=... "VRU Crashes 2016 to
2021 Final" (public view layer, no API key required).

Unlike crime/permits/requests/housing, this is NOT run through
date_window.py's rolling-recency filter: the upstream feed is a frozen
2016-2021 snapshot with no newer records, so a rolling window would just
shrink toward zero as the shared window advances rather than track real
recency. Applies equally to both cities (no cross-city bias), but the
snapshot will keep drifting further out of date until MnDOT/MnDPS publish
a newer extract — reapply filter_recent_years here if/when they do.
"""

import sys
from pathlib import Path as _BootstrapPath
sys.path.insert(0, str(_BootstrapPath(__file__).resolve().parent.parent))


import pandas as pd
from pathlib import Path
from core.load import resolve_boundaries, _fetch_arcgis_paginated
from shapely.geometry import Point, shape

PIPELINE_DIR = Path(__file__).resolve().parent.parent
FEATURE_SERVER = "https://services.arcgis.com/qWbGMYB49y8mLbRt/arcgis/rest/services/VRU_Crashes_2016_to_2021_2_view/FeatureServer/0"


def _fetch_crashes():
    # See clean_crime_mpls.py for why this now goes through the shared,
    # non-truncating paginator instead of a hand-rolled loop. Reshaped back
    # into feature-like dicts so the point-in-polygon loop below is unchanged.
    df = _fetch_arcgis_paginated(FEATURE_SERVER, out_fields="global_crash_severity,crash_mode")
    features = []
    for _, row in df.iterrows():
        geom = row.get("geometry")
        attrs = row.drop(labels=["geometry"], errors="ignore").to_dict()
        features.append({"geometry": geom, "attributes": attrs})
    return features


def clean_crashes(fallback_behavior="exclude_from_scoring_if_geography_fails", city="stpaul", granularity="district"):
    """
    Fetch pedestrian/cyclist crash locations and count them within each
    district or zip (point-in-polygon). city: 'stpaul' or 'mpls'.
    granularity: 'district' or 'zip'.

    Returns:
        DataFrame with columns: crash_id, district_id, severity
        (one row per crash found inside a zone; aggregate_by_source()
        counts rows per district_id since there is no "value" column)
    """
    boundaries = resolve_boundaries(city=city, granularity=granularity)

    boundary_map = {}
    for feature in boundaries["features"]:
        district_id = feature["properties"]["district_id"]
        boundary_map[district_id] = shape(feature["geometry"])

    try:
        features = _fetch_crashes()
    except Exception as e:
        if fallback_behavior == "strict":
            raise
        print(f"[WARNING] MnDOT crash data fetch failed ({e}); crashes will be excluded from scoring")
        return pd.DataFrame(columns=["crash_id", "district_id", "severity"])

    rows = []
    for i, feature in enumerate(features):
        geometry = feature.get("geometry")
        if not isinstance(geometry, dict) or "x" not in geometry or "y" not in geometry:
            continue
        point = Point(geometry["x"], geometry["y"])

        for district_id, polygon in boundary_map.items():
            if not polygon.contains(point):
                continue
            attrs = feature.get("attributes", {})
            rows.append({
                "crash_id": i,
                "district_id": district_id,
                "severity": attrs.get("global_crash_severity"),
            })
            break

    crashes = pd.DataFrame(rows, columns=["crash_id", "district_id", "severity"])

    if crashes.empty and fallback_behavior == "strict":
        raise ValueError("No crash data could be joined to districts")

    return crashes


if __name__ == "__main__":
    cleaned = clean_crashes()
    print(f"[OK] Cleaned crash data: {len(cleaned)} crashes")
    if not cleaned.empty:
        print(cleaned.groupby("district_id").size())
