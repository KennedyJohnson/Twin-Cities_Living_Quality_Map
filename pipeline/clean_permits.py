"""
Clean Building Permits data and assign districts via existing District Council column.
"""

import pandas as pd
from load import load_permits

def clean_permits():
    """
    Clean permits data. Use existing 'District Council' column if valid.

    Returns:
        DataFrame with columns: permit_id (or index), district_id, date, Latitude, Longtitude
    """
    permits = load_permits()

    # Ensure required columns exist
    required_cols = ["District Council", "Latitude", "Longtitude"]
    missing = [col for col in required_cols if col not in permits.columns]
    if missing:
        raise ValueError(f"Permits data missing columns: {missing}")

    # Use District Council column directly (already 1-17)
    permits["district_id"] = permits["District Council"]

    # Filter for valid lat/long
    permits = permits.dropna(subset=["Latitude", "Longtitude"])

    # Filter for valid district_id (1-17)
    permits = permits[(permits["district_id"] >= 1) & (permits["district_id"] <= 17)]

    return permits

if __name__ == "__main__":
    cleaned = clean_permits()
    print(f"[OK] Cleaned permits data: {len(cleaned)} records")
    print(f"Districts represented: {sorted(cleaned['district_id'].unique())}")
