"""
Clean Minneapolis Building Permits data (ArcGIS FeatureServer) and map to Communities
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

FEATURE_SERVER = MPLS_SOURCES["permits"]["featureServer"]

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


def _fetch_all_features(out_fields="Neighborhoods_Desc,permitNumber,issueDate,permitType,Display,workType,status,value"):
    # See clean_crime_mpls.py for why this now goes through the shared,
    # non-truncating paginator instead of a hand-rolled loop.
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


def clean_permits_mpls(crosswalk_file=CROSSWALK_FILE, granularity="district"):
    """
    Fetch Minneapolis permits data and assign district_id via crosswalk
    (district granularity), or via direct point-in-polygon against zip
    boundaries using the feed's own longitude/latitude (zip granularity).

    Returns:
        DataFrame with columns: district_id, permit_number, issue_date, permit_type
    """
    features = _fetch_all_features()
    permits = pd.DataFrame(features)
    # The CCS_Permits feed repeats a permit once per parcel it covers (e.g.
    # 1201 Yale Pl: 13 permits x 510 condo-unit rows = 6,630 rows, 9% of all
    # MPLS permits in the window). ~19% of rows were such repeats; count each
    # permit once so a single multi-unit building can't dominate its
    # community's permit rate. St. Paul's feed has one row per permit.
    if "permitNumber" in permits.columns:
        permits = permits.drop_duplicates(subset="permitNumber")

    if "Neighborhoods_Desc" not in permits.columns:
        raise ValueError("Minneapolis permits data missing Neighborhoods_Desc column")

    permits = permits.rename(columns={
        "permitNumber": "permit_number",
        "issueDate": "issue_date",
        "permitType": "permit_type",
        "Display": "address",
        "workType": "work_type",
        "status": "permit_status",
        "value": "permit_value",
    })

    if granularity == "zip":
        permits = permits.dropna(subset=["longitude", "latitude"])
        boundaries = load_zip_boundaries()
        boundary_map = {f["properties"]["district_id"]: shape(f["geometry"]) for f in boundaries["features"]}

        def find_zone(row):
            point = Point(row["longitude"], row["latitude"])
            for zone_id, polygon in boundary_map.items():
                if polygon.contains(point):
                    return zone_id
            return None

        permits["district_id"] = permits.apply(find_zone, axis=1)
        before_filter = len(permits)
        permits = permits.dropna(subset=["district_id"])
        after_filter = len(permits)
        filtered_count = before_filter - after_filter
        if filtered_count > 0:
            print(f"[WARNING] Filtered {filtered_count} MPLS permit records with no zip match via spatial join")
        permits["district_id"] = permits["district_id"].astype(int)
    else:
        crosswalk = json.loads(Path(crosswalk_file).read_text())
        permits["community_name"] = permits["Neighborhoods_Desc"].map(
            lambda x: crosswalk.get(str(x).strip())
        )

        before_filter = len(permits)
        permits = permits.dropna(subset=["community_name"])
        after_filter = len(permits)
        filtered_count = before_filter - after_filter
        if filtered_count > 0:
            print(f"[WARNING] Filtered {filtered_count} MPLS permit records with unmapped neighborhoods")

        permits["district_id"] = permits["community_name"].map(COMMUNITY_TO_DISTRICT_ID)

    # Restricted to a shared recent-years window — see core/date_window.py.
    permits = filter_recent_years(permits, "issue_date", epoch_ms=True)

    cols = ["district_id", "permit_number", "issue_date", "permit_type"]
    for extra in ["address", "work_type", "permit_status", "permit_value"]:
        if extra in permits.columns:
            cols.append(extra)
    if "longitude" in permits.columns:
        cols += ["longitude", "latitude"]
    return permits[cols]


if __name__ == "__main__":
    cleaned = clean_permits_mpls()
    print(f"[OK] Cleaned MPLS permits data: {len(cleaned)} records")
    print(f"Districts represented: {sorted(cleaned['district_id'].unique())}")
    print(cleaned["district_id"].value_counts())
