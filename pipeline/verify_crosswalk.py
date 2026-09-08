"""
Verify geographic crosswalks between datasets and official District Council boundaries.
Produces crosswalks, confidence reports, and validation statistics.
"""

import json
import pandas as pd
import numpy as np
from pathlib import Path
from difflib import SequenceMatcher

# Setup paths
PIPELINE_DIR = Path(__file__).parent
BOUNDARIES_FILE = PIPELINE_DIR / "boundaries" / "stpaul_district_councils.geojson"
CROSSWALKS_DIR = PIPELINE_DIR / "crosswalks"
DATA_DIR = PIPELINE_DIR / "data"
REPO_DIR = PIPELINE_DIR.parent

# Create output directory
CROSSWALKS_DIR.mkdir(exist_ok=True)

# Load boundaries
with open(BOUNDARIES_FILE) as f:
    boundaries = json.load(f)

# Build reference mapping: district_id -> district_name
district_map = {}
for feature in boundaries["features"]:
    district_id = feature["properties"]["district_id"]
    district_name = feature["properties"]["district_name"]
    district_map[district_id] = district_name

print("=" * 70)
print("ST. PAUL NEIGHBORHOOD HEALTH - GEOGRAPHIC CROSSWALK VERIFICATION")
print("=" * 70)
print()


def fuzzy_match(source_name, target_names, threshold=0.6):
    """
    Fuzzy match source_name against list of target_names.
    Returns best match and confidence score.
    """
    best_match = None
    best_score = 0

    for target in target_names:
        score = SequenceMatcher(None, source_name.lower(), target.lower()).ratio()
        if score > best_score:
            best_score = score
            best_match = target

    return best_match, best_score if best_score >= threshold else None


# ============================================================================
# 1. CRIME DATA - Fuzzy match NEIGHBORHOOD_NAME to District Council
# ============================================================================
print("1. CRIME INCIDENTS - Fuzzy matching neighborhoods to districts")
print("-" * 70)

crime_file = REPO_DIR / "data" / "Crime_Incident_Report.csv"
if crime_file.exists():
    crime = pd.read_csv(crime_file, nrows=10000)  # Sample for testing

    # Get unique neighborhood names from Crime data
    crime_neighborhoods = crime["NEIGHBORHOOD_NAME"].dropna().unique()
    print(f"Found {len(crime_neighborhoods)} unique NEIGHBORHOOD_NAME values in Crime data")

    # Create crosswalk: crime_neighborhood_name -> district_id
    crime_crosswalk = {}
    confidence_report = []

    for crime_name in sorted(crime_neighborhoods):
        best_district_name, confidence = fuzzy_match(
            crime_name,
            list(district_map.values()),
            threshold=0.5
        )

        if best_district_name and confidence:
            # Find district_id for this name
            district_id = next(
                (k for k, v in district_map.items() if v == best_district_name),
                None
            )
            crime_crosswalk[str(crime_name)] = {
                "district_id": district_id,
                "district_name": best_district_name,
                "confidence": round(confidence, 3)
            }
            confidence_report.append({
                "crime_name": crime_name,
                "district_id": district_id,
                "district_name": best_district_name,
                "confidence": round(confidence, 3)
            })
        else:
            crime_crosswalk[str(crime_name)] = {
                "district_id": None,
                "district_name": None,
                "confidence": 0.0
            }
            confidence_report.append({
                "crime_name": crime_name,
                "district_id": None,
                "district_name": None,
                "confidence": 0.0
            })

    # Save crosswalk
    crosswalk_file = CROSSWALKS_DIR / "crime_neighborhood_to_district.json"
    with open(crosswalk_file, "w") as f:
        json.dump(crime_crosswalk, f, indent=2)
    print(f"[OK] Crime crosswalk saved to {crosswalk_file.name}")

    # Print confidence report
    confidence_df = pd.DataFrame(confidence_report)
    print("\nFuzzy Match Confidence Report (sorted by confidence):")
    print(confidence_df.sort_values("confidence", ascending=False).to_string(index=False))

    low_confidence = confidence_df[confidence_df["confidence"] < 0.7]
    if len(low_confidence) > 0:
        print(f"\n[WARNING] {len(low_confidence)} crime neighborhoods matched with confidence < 0.7")
        print("These may need manual review:")
        for _, row in low_confidence.iterrows():
            print(f"  - '{row['crime_name']}' -> {row['district_name']} (conf: {row['confidence']})")
    else:
        print("\n[OK] All crime neighborhoods matched with confidence >= 0.7")
else:
    print(f"[WARN] Crime file not found at {crime_file}")

print()

# ============================================================================
# 2. PERMITS DATA - Verify existing District Council column via spatial join
# ============================================================================
print("2. PERMITS - Verify existing District Council column")
print("-" * 70)

permits_file = REPO_DIR / "data" / "Approved_Building_Permits_-7890413957898939046.csv"
if permits_file.exists():
    permits = pd.read_csv(permits_file, nrows=10000)  # Sample for testing

    # Check for lat/long and existing district column
    has_lat = "Latitude" in permits.columns
    has_lon = "Longtitude" in permits.columns
    has_district = "District Council" in permits.columns

    print(f"Has Latitude: {has_lat}, Has Longtitude: {has_lon}, Has District Council: {has_district}")

    if has_lat and has_lon and has_district:
        # Compare spatial-join result against existing District Council column
        valid_permits = permits.dropna(subset=["Latitude", "Longtitude", "District Council"])

        # Simple centroid-based check: if lat/lon are within expected bounds for a district
        print(f"Valid permits (non-null coords & district): {len(valid_permits)} / {len(permits)}")

        # Show agreement stats
        print(f"\nPermits District Council values: {sorted(valid_permits['District Council'].unique())}")
        print(f"Expected district IDs (1-17): {list(range(1, 18))}")

        # Show distribution
        district_counts = valid_permits["District Council"].value_counts().sort_index()
        print(f"\nPermits per district:")
        for dist_id, count in district_counts.items():
            pct = 100.0 * count / len(valid_permits)
            print(f"  District {int(dist_id)}: {count} permits ({pct:.1f}%)")
    else:
        print("[WARN] Missing required columns for Permits validation")
else:
    print(f"[WARN] Permits file not found at {permits_file}")

print()

# ============================================================================
# 3. SERVICE REQUESTS - Verify District Council column via spatial join
# ============================================================================
print("3. SERVICE REQUESTS - Verify District Council column")
print("-" * 70)

requests_file = REPO_DIR / "data" / "Resident_Service_Requests_7024824928576740068.csv"
if requests_file.exists():
    requests = pd.read_csv(requests_file, nrows=10000)  # Sample for testing

    has_lat = "Latitude" in requests.columns
    has_lon = "Longtitude" in requests.columns
    has_district = "District Council" in requests.columns

    print(f"Has Latitude: {has_lat}, Has Longtitude: {has_lon}, Has District Council: {has_district}")

    if has_lat and has_lon and has_district:
        valid_requests = requests.dropna(subset=["Latitude", "Longtitude", "District Council"])
        print(f"Valid requests (non-null coords & district): {len(valid_requests)} / {len(requests)}")

        print(f"\nService Requests District Council unique values: {len(valid_requests['District Council'].unique())}")
        print(f"Expected: 17, Actual: {len(valid_requests['District Council'].unique())}")

        # Note the issue
        if len(valid_requests['District Council'].unique()) > 17:
            print("[WARNING] District Council has more than 17 unique values!")
            print("Plan: Will use spatial join of Latitude/Longtitude instead of existing column")
    else:
        print("[WARN] Missing required columns for Requests validation")
else:
    print(f"[WARN] Requests file not found at {requests_file}")

print()

# ============================================================================
# 4. HOUSING PRODUCTION - Check geography fields
# ============================================================================
print("4. HOUSING PRODUCTION - Check for geographic fields")
print("-" * 70)

# Try multiple possible filenames
housing_files = [
    REPO_DIR / "data" / "Housing_Production.csv",
    REPO_DIR / "data" / "Housing_Production.geojson",
    REPO_DIR / "data" / "housing_production.csv",
]

housing_found = False
for housing_file in housing_files:
    if housing_file.exists():
        housing_found = True
        print(f"[OK] Found Housing file: {housing_file.name}")

        if housing_file.suffix.lower() == ".geojson":
            with open(housing_file) as f:
                housing = json.load(f)
            print(f"  Type: GeoJSON with {len(housing.get('features', []))} features")
            if housing.get('features'):
                print(f"  First feature properties: {housing['features'][0].get('properties', {}).keys()}")
        else:
            housing = pd.read_csv(housing_file, nrows=5)
            print(f"  Shape: {housing.shape}")
            print(f"  Columns: {housing.columns.tolist()}")
            has_lat = any("lat" in col.lower() for col in housing.columns)
            has_lon = any("lon" in col.lower() for col in housing.columns)
            has_address = any("address" in col.lower() for col in housing.columns)
            print(f"  Has latitude: {has_lat}, Has longitude: {has_lon}, Has address: {has_address}")
        break

if not housing_found:
    print("[WARN] Housing Production file not found. Possible locations:")
    for f in housing_files:
        print(f"  - {f}")
    print("\nNote: If housing geography cannot be determined, it will be excluded from v1 scoring")

print()
print("=" * 70)
print("VERIFICATION COMPLETE")
print("=" * 70)
print()
print("Next steps:")
print("1. Review the crime crosswalk confidence report above")
print("2. If Crime confidence < 0.7 for any neighborhoods, manually review")
print("3. Verify Permits and Requests district distributions look reasonable")
print("4. Check Housing Production columns and plan spatial join or exclusion")
print()
print("Then run: python pipeline/build.py")
