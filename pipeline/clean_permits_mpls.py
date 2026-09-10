"""
Clean Minneapolis Building Permits data (ArcGIS FeatureServer) and map to Communities
via the neighborhood->community crosswalk.
"""

import json
import requests
import pandas as pd
from pathlib import Path

PIPELINE_DIR = Path(__file__).parent
MPLS_SOURCES = json.loads((PIPELINE_DIR / "config" / "mpls_sources.json").read_text())
CROSSWALK_FILE = PIPELINE_DIR / "config" / "mpls_neighborhood_to_community.json"

FEATURE_SERVER = MPLS_SOURCES["permits"]["featureServer"]
PAGE_SIZE = 2000

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


def _fetch_all_features(out_fields="Neighborhoods_Desc,permitNumber,issueDate,permitType"):
    query_url = f"{FEATURE_SERVER}/query"
    features = []
    offset = 0
    while True:
        params = {
            "where": "1=1",
            "outFields": out_fields,
            "resultOffset": offset,
            "resultRecordCount": PAGE_SIZE,
            "f": "json",
        }
        resp = requests.get(query_url, params=params, timeout=60)
        resp.raise_for_status()
        data = resp.json()
        batch = data.get("features", [])
        if not batch:
            break
        features.extend(batch)
        if len(batch) < PAGE_SIZE:
            break
        offset += PAGE_SIZE
    return features


def clean_permits_mpls(crosswalk_file=CROSSWALK_FILE):
    """
    Fetch Minneapolis permits data and assign district_id via crosswalk.

    Returns:
        DataFrame with columns: district_id, permit_number, issue_date, permit_type
    """
    crosswalk = json.loads(Path(crosswalk_file).read_text())

    features = _fetch_all_features()
    rows = []
    for f in features:
        attrs = dict(f["attributes"])
        geom = f.get("geometry")
        if geom and "x" in geom and "y" in geom:
            attrs["longitude"] = geom["x"]
            attrs["latitude"] = geom["y"]
        rows.append(attrs)
    permits = pd.DataFrame(rows)

    if "Neighborhoods_Desc" not in permits.columns:
        raise ValueError("Minneapolis permits data missing Neighborhoods_Desc column")

    permits["community_name"] = permits["Neighborhoods_Desc"].map(
        lambda x: crosswalk.get(str(x).strip())
    )

    before_filter = len(permits)
    permits = permits.dropna(subset=["community_name"])
    after_filter = len(permits)
    filtered_count = before_filter - after_filter
    if filtered_count > 0:
        print(f"[WARNING] Filtered {filtered_count} MPLS permit records with unmapped neighborhoods")

    permits = permits.rename(columns={
        "permitNumber": "permit_number",
        "issueDate": "issue_date",
        "permitType": "permit_type",
    })

    permits["district_id"] = permits["community_name"].map(COMMUNITY_TO_DISTRICT_ID)

    cols = ["district_id", "permit_number", "issue_date", "permit_type"]
    if "longitude" in permits.columns:
        cols += ["longitude", "latitude"]
    return permits[cols]


if __name__ == "__main__":
    cleaned = clean_permits_mpls()
    print(f"[OK] Cleaned MPLS permits data: {len(cleaned)} records")
    print(f"Districts represented: {sorted(cleaned['district_id'].unique())}")
    print(cleaned["district_id"].value_counts())
