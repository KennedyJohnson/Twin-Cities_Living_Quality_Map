"""
Diagnostic script to understand why spatial joins are failing.
Checks coordinate ranges and boundary coverage.
"""

import pandas as pd
import json
from pathlib import Path
from load import load_requests, load_housing, load_boundaries
from shapely.geometry import shape

PIPELINE_DIR = Path(__file__).parent

def diagnose_requests():
    """Check why requests spatial join is failing."""
    print("=" * 70)
    print("REQUESTS SPATIAL JOIN DIAGNOSTICS")
    print("=" * 70)

    requests = load_requests()
    valid_requests = requests.dropna(subset=["Latitude", "Longtitude"])
    print(f"Total requests: {len(requests)}, Valid coords: {len(valid_requests)}")
    print(f"Latitude range: {valid_requests['Latitude'].min()} to {valid_requests['Latitude'].max()}")
    print(f"Longtitude range: {valid_requests['Longtitude'].min()} to {valid_requests['Longtitude'].max()}")

    # Check boundary coverage
    boundaries = load_boundaries()
    all_bounds = []
    for feature in boundaries["features"]:
        geom = shape(feature["geometry"])
        bounds = geom.bounds  # (minx, miny, maxx, maxy)
        all_bounds.append(bounds)
        district_id = feature["properties"]["district_id"]
        print(f"  District {district_id}: lat [{bounds[1]:.4f}, {bounds[3]:.4f}], lon [{bounds[0]:.4f}, {bounds[2]:.4f}]")

    print()
    print("Sample request coordinates (first 5):")
    for idx, row in valid_requests.head().iterrows():
        print(f"  Lat: {row['Latitude']:.4f}, Lon: {row['Longtitude']:.4f}")

    print()

def diagnose_housing():
    """Check housing coordinate system."""
    print("=" * 70)
    print("HOUSING COORDINATES DIAGNOSTICS")
    print("=" * 70)

    housing = load_housing()
    print(f"Total housing records: {len(housing)}")
    print(f"Columns: {housing.columns.tolist()}")

    # Check for coordinate columns
    for col in housing.columns:
        if any(coord_word in col.lower() for coord_word in ["lat", "lon", "x", "y", "coord"]):
            valid = housing[col].notna().sum()
            print(f"\n{col}:")
            print(f"  Valid values: {valid}")
            print(f"  Range: {housing[col].min()} to {housing[col].max()}")
            print(f"  Sample values: {housing[col].dropna().head(3).tolist()}")

    print()

if __name__ == "__main__":
    diagnose_requests()
    diagnose_housing()
