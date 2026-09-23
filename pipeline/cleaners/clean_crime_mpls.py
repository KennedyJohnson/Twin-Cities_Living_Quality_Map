"""
Clean Minneapolis Crime Data (ArcGIS FeatureServer) and map to Communities
via the neighborhood->community crosswalk.
"""

import sys
from pathlib import Path as _BootstrapPath
sys.path.insert(0, str(_BootstrapPath(__file__).resolve().parent.parent))


import json
import pandas as pd
from pathlib import Path
from core.load import _fetch_arcgis_paginated, load_zip_boundaries
from core.date_window import filter_recent_years
from shapely.geometry import Point, shape

PIPELINE_DIR = Path(__file__).resolve().parent.parent
MPLS_SOURCES = json.loads((PIPELINE_DIR / "config" / "mpls_sources.json").read_text())
CROSSWALK_FILE = PIPELINE_DIR / "config" / "mpls_neighborhood_to_community.json"

FEATURE_SERVER = MPLS_SOURCES["crime"]["featureServer"]

COMMUNITY_TO_DISTRICT_ID = {
    "Calhoun Isle": 101,
    "Camden": 102,
    "Central": 103,
    "Longfellow": 104,
    "Near North": 105,
    "Nokomis": 106,
    "Northeast": 107,
    "Phillips": 108,
    "Powderhorn": 109,
    "Southwest": 110,
    "University": 111,
}


def _fetch_all_features(out_fields="Neighborhood,Offense_Category,Occurred_Date,Offense,Address,Precinct"):
    # _fetch_arcgis_paginated requests outSR=4326 (WGS84), so geometry comes
    # back as lon/lat directly — no manual Web Mercator conversion needed.
    # It also doesn't stop early on a short page (some FeatureServers cap
    # responses below the requested page size regardless), unlike the old
    # hand-rolled loop here that silently truncated on any such cap.
    df = _fetch_arcgis_paginated(FEATURE_SERVER, out_fields=out_fields)
    features = []
    for _, row in df.iterrows():
        attrs = row.drop(labels=["geometry"], errors="ignore").to_dict()
        geom = row.get("geometry")
        if isinstance(geom, dict) and "x" in geom and "y" in geom:
            attrs["longitude"] = geom["x"]
            attrs["latitude"] = geom["y"]
        features.append(attrs)
    return features


EXCLUDED_OFFENSE_CATEGORIES = {
    "Subset of NIBRS Assault Offenses",
    "Subset of NIBRS Robbery",
    "Gunshot Wound Victims",
    "Shots Fired Calls",
}


def clean_crime_mpls(crosswalk_file=CROSSWALK_FILE, granularity="district"):
    """
    Fetch Minneapolis crime data and assign district_id via crosswalk
    (district granularity), or via direct point-in-polygon against zip
    boundaries using the feed's own longitude/latitude (zip granularity —
    more accurate than the crosswalk anyway, but district granularity keeps
    the crosswalk for continuity with existing scores).

    Returns:
        DataFrame with columns: district_id, offense_category, occurred_date
    """
    features = _fetch_all_features()
    crime = pd.DataFrame(features)
    # Drop categories that aren't distinct reported offenses (2026-09 audit):
    # the "Subset of NIBRS ..." rows (domestic aggravated assault,
    # carjacking) and "Gunshot Wound Victims" matched an existing
    # Assault/Robbery/Homicide record on the same day and address 99.5-100%
    # of the time, so they double-count; "Shots Fired Calls" are 911/
    # ShotSpotter activations, not confirmed incidents, with no equivalent
    # in St. Paul's offense feed.
    if "Offense_Category" in crime.columns:
        crime = crime[~crime["Offense_Category"].astype(str).str.strip().isin(EXCLUDED_OFFENSE_CATEGORIES)]

    if "Neighborhood" not in crime.columns:
        raise ValueError("Minneapolis crime data missing Neighborhood column")

    crime = crime.rename(columns={
        "Offense_Category": "offense_category",
        "Occurred_Date": "occurred_date",
        "Offense": "offense",
        "Address": "address",
        "Precinct": "precinct",
    })

    if granularity == "zip":
        crime = crime.dropna(subset=["longitude", "latitude"])
        boundaries = load_zip_boundaries()
        boundary_map = {f["properties"]["district_id"]: shape(f["geometry"]) for f in boundaries["features"]}

        def find_zone(row):
            point = Point(row["longitude"], row["latitude"])
            for zone_id, polygon in boundary_map.items():
                if polygon.contains(point):
                    return zone_id
            return None

        crime["district_id"] = crime.apply(find_zone, axis=1)
        before_filter = len(crime)
        crime = crime.dropna(subset=["district_id"])
        after_filter = len(crime)
        filtered_count = before_filter - after_filter
        if filtered_count > 0:
            print(f"[WARNING] Filtered {filtered_count} MPLS crime records with no zip match via spatial join")
        crime["district_id"] = crime["district_id"].astype(int)
    else:
        crosswalk = json.loads(Path(crosswalk_file).read_text())
        crime["community_name"] = crime["Neighborhood"].map(
            lambda x: crosswalk.get(str(x).strip())
        )

        before_filter = len(crime)
        crime = crime.dropna(subset=["community_name"])
        after_filter = len(crime)
        filtered_count = before_filter - after_filter
        if filtered_count > 0:
            print(f"[WARNING] Filtered {filtered_count} MPLS crime records with unmapped neighborhoods")

        crime["district_id"] = crime["community_name"].map(COMMUNITY_TO_DISTRICT_ID)

    # Restricted to a shared recent-years window so this compares fairly
    # against St. Paul's longer crime history — see core/date_window.py.
    crime = filter_recent_years(crime, "occurred_date", epoch_ms=True)

    cols = ["district_id", "offense_category", "occurred_date"]
    for extra in ["offense", "address", "precinct"]:
        if extra in crime.columns:
            cols.append(extra)
    if "longitude" in crime.columns:
        cols += ["longitude", "latitude"]
    return crime[cols]


if __name__ == "__main__":
    cleaned = clean_crime_mpls()
    print(f"[OK] Cleaned MPLS crime data: {len(cleaned)} records")
    print(f"Districts represented: {sorted(cleaned['district_id'].unique())}")
    print(cleaned["district_id"].value_counts())
