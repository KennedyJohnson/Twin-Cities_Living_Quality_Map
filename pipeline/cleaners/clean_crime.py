"""
Clean Crime Incident data and map to districts via crosswalk.
"""

import sys
from pathlib import Path as _BootstrapPath
sys.path.insert(0, str(_BootstrapPath(__file__).resolve().parent.parent))


import pandas as pd
import json
from pathlib import Path
from core.load import load_crime, load_crosswalk, load_zip_boundaries
from core.date_window import filter_recent_years
from core.geocode_blocks import geocode_blocks
from shapely.geometry import Point, shape

PIPELINE_DIR = Path(__file__).resolve().parent.parent

NON_CRIME_INCIDENTS = {"Proactive Police Visit", "Community Event"}


def clean_crime(crosswalk_file="crosswalks/crime_neighborhood_to_district.json", granularity="district"):
    """
    Clean crime data and assign district_id via crosswalk (district
    granularity), or via point-in-polygon against zip boundaries using
    geocoded block-center coordinates (zip granularity — the crosswalk
    only resolves to a district, not a zip, so zip mode geocodes the BLOCK
    field instead; see clean_crime_with_points()).

    Returns:
        DataFrame with columns: incident_id (or index), district_id, date, ...
    """
    crime = load_crime()
    # St. Paul's Crime Incident Report feed also logs police activity that
    # isn't a reported crime -- "Proactive Police Visit" and "Community
    # Event" were ~53% of rows in the scoring window (2026-09 audit).
    # Counting them roughly doubled St. Paul's crime rate relative to
    # Minneapolis's offense-only feed and made the rate partly a measure of
    # patrol intensity rather than crime.
    if "INCIDENT" in crime.columns:
        crime = crime[~crime["INCIDENT"].astype(str).str.strip().isin(NON_CRIME_INCIDENTS)]
    # Restricted to a shared recent-years window so St. Paul's longer crime
    # history doesn't inflate its rate relative to Minneapolis's shorter
    # one — see core/date_window.py.
    crime = filter_recent_years(crime, "DATE", epoch_ms=True)

    if granularity == "zip":
        if "BLOCK" not in crime.columns:
            raise ValueError("Crime data missing BLOCK column needed for zip-level geocoding")

        geocoded = geocode_blocks(crime["BLOCK"])
        crime["latitude"] = crime["BLOCK"].map(lambda b: (geocoded.get(str(b).strip()) or (None, None))[0])
        crime["longitude"] = crime["BLOCK"].map(lambda b: (geocoded.get(str(b).strip()) or (None, None))[1])
        crime = crime.dropna(subset=["latitude", "longitude"])

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
            print(f"[WARNING] Filtered {filtered_count} crime records with no zip match via geocoding/spatial join")
        crime["district_id"] = crime["district_id"].astype(int)
        return crime

    # Load crosswalk
    crosswalk = load_crosswalk(crosswalk_file)

    # Ensure NEIGHBORHOOD_NAME exists
    if "NEIGHBORHOOD_NAME" not in crime.columns:
        raise ValueError("Crime data missing NEIGHBORHOOD_NAME column")

    # Map NEIGHBORHOOD_NAME to district_id
    crime["district_id"] = crime["NEIGHBORHOOD_NAME"].map(
        lambda x: crosswalk.get(str(x), {}).get("district_id")
    )

    # Filter out rows that couldn't be mapped (district_id is None)
    before_filter = len(crime)
    crime = crime.dropna(subset=["district_id"])
    after_filter = len(crime)
    filtered_count = before_filter - after_filter
    if filtered_count > 0:
        print(f"[WARNING] Filtered {filtered_count} crime records with unmapped neighborhoods")

    # Convert district_id to int
    crime["district_id"] = crime["district_id"].astype(int)

    return crime


def clean_crime_with_points(crosswalk_file="crosswalks/crime_neighborhood_to_district.json"):
    """Like clean_crime(), but also attaches an approximate latitude/longitude
    per incident by geocoding the BLOCK field's block-level address or
    intersection description. St. Paul's crime feed has no true coordinates,
    so these points are block-center approximations, not exact incident
    locations — see core/geocode_blocks.py.
    """
    crime = clean_crime(crosswalk_file)

    if "BLOCK" not in crime.columns:
        crime["latitude"] = None
        crime["longitude"] = None
        return crime

    geocoded = geocode_blocks(crime["BLOCK"])

    def _lookup(block, index):
        coords = geocoded.get(str(block).strip())
        return coords[index] if coords else None

    crime["latitude"] = crime["BLOCK"].map(lambda b: _lookup(b, 0))
    crime["longitude"] = crime["BLOCK"].map(lambda b: _lookup(b, 1))

    geocoded_count = crime["latitude"].notna().sum()
    print(f"[OK] Geocoded {geocoded_count}/{len(crime)} St. Paul crime incidents to approximate points")

    return crime

if __name__ == "__main__":
    cleaned = clean_crime()
    print(f"[OK] Cleaned crime data: {len(cleaned)} records")
    print(f"Districts represented: {sorted(cleaned['district_id'].unique())}")
