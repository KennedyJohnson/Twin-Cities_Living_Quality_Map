"""
Clean Minneapolis Housing Production data. No dedicated housing dataset exists
for Minneapolis, so this derives a proxy from CCS_Permits filtered to
permitType == 'Res' (residential permits), joined to Communities via the
neighborhood->community crosswalk.
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


def _fetch_all_features(out_fields="Neighborhoods_Desc,permitNumber,issueDate,permitType,Display,dwellingUnitsNew,occupancyType"):
    # See clean_crime_mpls.py for why this now goes through the shared,
    # non-truncating paginator instead of a hand-rolled loop.
    df = _fetch_arcgis_paginated(FEATURE_SERVER, where="permitType='Res'", out_fields=out_fields)
    features = []
    for _, row in df.iterrows():
        attrs = row.drop(labels=["geometry"], errors="ignore").to_dict()
        geom = row.get("geometry")
        if isinstance(geom, dict) and "x" in geom and "y" in geom:
            attrs["longitude"] = geom["x"]
            attrs["latitude"] = geom["y"]
        features.append(attrs)
    return features


def clean_housing_mpls(crosswalk_file=CROSSWALK_FILE, granularity="district"):
    """
    Fetch Minneapolis residential permits (proxy for housing production) and
    assign district_id via crosswalk (district granularity), or via direct
    point-in-polygon against zip boundaries using the feed's own
    longitude/latitude (zip granularity).

    Returns:
        DataFrame with columns: district_id, permit_number, issue_date, permit_type
    """
    features = _fetch_all_features()
    housing = pd.DataFrame(features)

    if "Neighborhoods_Desc" not in housing.columns:
        raise ValueError("Minneapolis permits data missing Neighborhoods_Desc column")

    housing = housing.rename(columns={
        "permitNumber": "permit_number",
        "issueDate": "issue_date",
        "permitType": "permit_type",
        "Display": "address",
        "dwellingUnitsNew": "new_dwelling_units",
        "occupancyType": "occupancy_type",
    })

    if granularity == "zip":
        housing = housing.dropna(subset=["longitude", "latitude"])
        boundaries = load_zip_boundaries()
        boundary_map = {f["properties"]["district_id"]: shape(f["geometry"]) for f in boundaries["features"]}

        def find_zone(row):
            point = Point(row["longitude"], row["latitude"])
            for zone_id, polygon in boundary_map.items():
                if polygon.contains(point):
                    return zone_id
            return None

        housing["district_id"] = housing.apply(find_zone, axis=1)
        before_filter = len(housing)
        housing = housing.dropna(subset=["district_id"])
        after_filter = len(housing)
        filtered_count = before_filter - after_filter
        if filtered_count > 0:
            print(f"[WARNING] Filtered {filtered_count} MPLS housing records with no zip match via spatial join")
        housing["district_id"] = housing["district_id"].astype(int)
    else:
        crosswalk = json.loads(Path(crosswalk_file).read_text())
        housing["community_name"] = housing["Neighborhoods_Desc"].map(
            lambda x: crosswalk.get(str(x).strip())
        )

        before_filter = len(housing)
        housing = housing.dropna(subset=["community_name"])
        after_filter = len(housing)
        filtered_count = before_filter - after_filter
        if filtered_count > 0:
            print(f"[WARNING] Filtered {filtered_count} MPLS housing (Res permit) records with unmapped neighborhoods")

        housing["district_id"] = housing["community_name"].map(COMMUNITY_TO_DISTRICT_ID)

    # St. Paul's housing_rate_pc counts actual new dwelling units produced,
    # not permit records — a single MPLS permit can cover a 100-unit
    # building, so counting rows (as this used to) badly undercounts large
    # developments and overcounts single-unit remodel permits equally with
    # new construction. "value" is aggregate.py's convention for a column to
    # sum instead of counting rows; dwellingUnitsNew makes the two cities'
    # housing_rate_pc comparable.
    if "new_dwelling_units" in housing.columns:
        housing["value"] = pd.to_numeric(housing["new_dwelling_units"], errors="coerce").fillna(0)

    # Restricted to a shared recent-years window — see core/date_window.py.
    housing = filter_recent_years(housing, "issue_date", epoch_ms=True)

    cols = ["district_id", "permit_number", "issue_date", "permit_type"]
    for extra in ["address", "new_dwelling_units", "occupancy_type", "value"]:
        if extra in housing.columns:
            cols.append(extra)
    if "longitude" in housing.columns:
        cols += ["longitude", "latitude"]
    return housing[cols]


if __name__ == "__main__":
    cleaned = clean_housing_mpls()
    print(f"[OK] Cleaned MPLS housing (Res permits) data: {len(cleaned)} records")
    print(f"Districts represented: {sorted(cleaned['district_id'].unique())}")
    print(cleaned["district_id"].value_counts())
