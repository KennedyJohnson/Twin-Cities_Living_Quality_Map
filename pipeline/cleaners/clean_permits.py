"""
Clean Building Permits data and assign districts via existing District Council column.
"""

import sys
from pathlib import Path as _BootstrapPath
sys.path.insert(0, str(_BootstrapPath(__file__).resolve().parent.parent))


import pandas as pd
from core.load import load_permits, resolve_boundaries
from core.date_window import filter_recent_years
from shapely.geometry import Point, shape

COMPARABLE_FOLDER_TYPES = {
    "Building Permit",
    "Mechanical Permit",
    "Plumbing/Gasfitting/Inside Water Piping",
    "Warm Air, Ventilation & General Sheet",
    "Demolition Permit",
}


def clean_permits(granularity="district"):
    """
    Clean permits data. Use existing 'District Council' column if valid
    (district granularity), or spatially join Latitude/Longtitude against
    zip boundaries (zip granularity, since permits carry no zip column).

    Returns:
        DataFrame with columns: permit_id (or index), district_id, date, Latitude, Longtitude
    """
    permits = load_permits()
    # Restricted to a shared recent-years window so this compares fairly
    # against Minneapolis's shorter permit history — see core/date_window.py.
    permits = filter_recent_years(permits, "ISSUEDATE", epoch_ms=True)
    # Keep only permit categories Minneapolis's CCS_Permits feed also
    # contains (building/residential/commercial, plumbing, mechanical,
    # demolition). St. Paul's feed additionally includes electrical (~24% of
    # rows), fence, fire engineering, elevator, sign, and stucco permits,
    # which Minneapolis doesn't publish in this feed -- counting them
    # inflated St. Paul's permit rate and Opportunity index (2026-09 audit).
    if "FOLDER_TYPE" in permits.columns:
        permits = permits[permits["FOLDER_TYPE"].astype(str).str.strip().isin(COMPARABLE_FOLDER_TYPES)]

    # Ensure required columns exist
    required_cols = ["District Council", "Latitude", "Longtitude"]
    missing = [col for col in required_cols if col not in permits.columns]
    if missing:
        raise ValueError(f"Permits data missing columns: {missing}")

    # Filter for valid lat/long
    permits = permits.dropna(subset=["Latitude", "Longtitude"])

    if granularity == "zip":
        boundaries = resolve_boundaries(city="stpaul", granularity="zip")
        boundary_map = {f["properties"]["district_id"]: shape(f["geometry"]) for f in boundaries["features"]}

        def find_zone(row):
            point = Point(row["Longtitude"], row["Latitude"])
            for zone_id, polygon in boundary_map.items():
                if polygon.contains(point):
                    return zone_id
            return None

        permits["district_id"] = permits.apply(find_zone, axis=1)
        permits = permits.dropna(subset=["district_id"])
        permits["district_id"] = permits["district_id"].astype(int)
    else:
        # Use District Council column directly (already 1-17)
        permits["district_id"] = permits["District Council"]
        # Filter for valid district_id (1-17)
        permits = permits[(permits["district_id"] >= 1) & (permits["district_id"] <= 17)]

    return permits

if __name__ == "__main__":
    cleaned = clean_permits()
    print(f"[OK] Cleaned permits data: {len(cleaned)} records")
    print(f"Districts represented: {sorted(cleaned['district_id'].unique())}")
