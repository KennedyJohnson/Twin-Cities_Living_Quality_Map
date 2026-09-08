"""
Clean Crime Incident data and map to districts via crosswalk.
"""

import pandas as pd
import json
from pathlib import Path
from load import load_crime, load_crosswalk

PIPELINE_DIR = Path(__file__).parent

def clean_crime(crosswalk_file="crosswalks/crime_neighborhood_to_district.json"):
    """
    Clean crime data and assign district_id via crosswalk.

    Returns:
        DataFrame with columns: incident_id (or index), district_id, date, ...
    """
    crime = load_crime()

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

if __name__ == "__main__":
    cleaned = clean_crime()
    print(f"[OK] Cleaned crime data: {len(cleaned)} records")
    print(f"Districts represented: {sorted(cleaned['district_id'].unique())}")
