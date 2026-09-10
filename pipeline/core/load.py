"""
Load raw data files (CSV/GeoJSON) into memory.
Returns DataFrames for each dataset with minimal processing.
Supports optional API-based loading with fallback to local CSVs.
"""

import sys
from pathlib import Path as _BootstrapPath
sys.path.insert(0, str(_BootstrapPath(__file__).resolve().parent.parent))


import pandas as pd
import json
from pathlib import Path
import os

PIPELINE_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = PIPELINE_DIR.parent

# Load .env file if it exists (for local development)
_env_file = PIPELINE_DIR / ".env"
if _env_file.exists():
    try:
        from dotenv import load_dotenv
        load_dotenv(_env_file)
    except ImportError:
        # Manually load .env if dotenv not available
        with open(_env_file) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, value = line.split("=", 1)
                    os.environ.setdefault(key.strip(), value.strip())

# St. Paul Socrata configuration
STPAUL_DOMAIN = "https://information.stpaul.gov"
STPAUL_DATASET_IDS = {
    "crime": os.getenv("STPAUL_CRIME_ID", ""),
    "permits": os.getenv("STPAUL_PERMITS_ID", ""),
    "requests": os.getenv("STPAUL_REQUESTS_ID", ""),
    "housing": os.getenv("STPAUL_HOUSING_ID", ""),
}

def load_crime():
    """Load Crime Incident Report from Socrata API (with CSV fallback)."""
    if STPAUL_DATASET_IDS["crime"]:
        try:
            from core.socrata import fetch_socrata_paginated
            print("[INFO] Attempting to load crime data from St. Paul Socrata API...")
            df = fetch_socrata_paginated(
                STPAUL_DOMAIN,
                STPAUL_DATASET_IDS["crime"],
                page_size=10000
            )
            if not df.empty:
                print(f"[OK] Loaded {len(df)} crime records from API")
                return df
        except Exception as e:
            print(f"[WARNING] Failed to load crime from API: {e}. Falling back to CSV.")

    crime_file = REPO_DIR / "data" / "Crime_Incident_Report.csv"
    if not crime_file.exists():
        raise FileNotFoundError(f"Crime file not found: {crime_file}")
    print("[INFO] Loading crime data from local CSV")
    return pd.read_csv(crime_file)

def load_permits():
    """Load Building Permits from Socrata API (with CSV fallback)."""
    if STPAUL_DATASET_IDS["permits"]:
        try:
            from core.socrata import fetch_socrata_paginated
            print("[INFO] Attempting to load permits data from St. Paul Socrata API...")
            df = fetch_socrata_paginated(
                STPAUL_DOMAIN,
                STPAUL_DATASET_IDS["permits"],
                page_size=10000
            )
            if not df.empty:
                print(f"[OK] Loaded {len(df)} permit records from API")
                return df
        except Exception as e:
            print(f"[WARNING] Failed to load permits from API: {e}. Falling back to CSV.")

    permits_file = REPO_DIR / "data" / "Approved_Building_Permits_-7890413957898939046.csv"
    if not permits_file.exists():
        raise FileNotFoundError(f"Permits file not found: {permits_file}")
    print("[INFO] Loading permits data from local CSV")
    return pd.read_csv(permits_file)

def load_requests():
    """Load Service Requests from Socrata API (with CSV fallback)."""
    if STPAUL_DATASET_IDS["requests"]:
        try:
            from core.socrata import fetch_socrata_paginated
            print("[INFO] Attempting to load service requests data from St. Paul Socrata API...")
            df = fetch_socrata_paginated(
                STPAUL_DOMAIN,
                STPAUL_DATASET_IDS["requests"],
                page_size=10000
            )
            if not df.empty:
                print(f"[OK] Loaded {len(df)} service request records from API")
                return df
        except Exception as e:
            print(f"[WARNING] Failed to load requests from API: {e}. Falling back to CSV.")

    requests_file = REPO_DIR / "data" / "Resident_Service_Requests_7024824928576740068.csv"
    if not requests_file.exists():
        raise FileNotFoundError(f"Requests file not found: {requests_file}")
    print("[INFO] Loading service requests data from local CSV")
    return pd.read_csv(requests_file)

def load_housing():
    """Load Housing Production from Socrata API or CSV/GeoJSON (with fallback)."""
    if STPAUL_DATASET_IDS["housing"]:
        try:
            from core.socrata import fetch_socrata_paginated
            print("[INFO] Attempting to load housing production data from St. Paul Socrata API...")
            df = fetch_socrata_paginated(
                STPAUL_DOMAIN,
                STPAUL_DATASET_IDS["housing"],
                page_size=10000
            )
            if not df.empty:
                print(f"[OK] Loaded {len(df)} housing records from API")
                return df
        except Exception as e:
            print(f"[WARNING] Failed to load housing from API: {e}. Falling back to CSV/GeoJSON.")

    # Try CSV first
    housing_csv = REPO_DIR / "data" / "Housing_Production.csv"
    if housing_csv.exists():
        print("[INFO] Loading housing production data from local CSV")
        return pd.read_csv(housing_csv)

    # Try GeoJSON
    housing_geojson = REPO_DIR / "data" / "Housing_Production.geojson"
    if housing_geojson.exists():
        print("[INFO] Loading housing production data from local GeoJSON")
        with open(housing_geojson) as f:
            geojson = json.load(f)
        # Convert GeoJSON features to DataFrame
        features = geojson.get("features", [])
        rows = []
        for feature in features:
            props = feature.get("properties", {})
            if feature.get("geometry") and feature["geometry"].get("coordinates"):
                lon, lat = feature["geometry"]["coordinates"][:2]
                props["longitude"] = lon
                props["latitude"] = lat
            rows.append(props)
        return pd.DataFrame(rows) if rows else pd.DataFrame()

    raise FileNotFoundError(f"Housing file not found (tried API, .csv, and .geojson)")

def load_population(city="stpaul"):
    """Load population by district. city: 'stpaul' or 'mpls'."""
    filename = "population_by_district_mpls.csv" if city == "mpls" else "population_by_district.csv"
    pop_file = PIPELINE_DIR / "data" / filename
    if not pop_file.exists():
        raise FileNotFoundError(f"Population file not found: {pop_file}")
    return pd.read_csv(pop_file)

def load_boundaries(city="stpaul"):
    """Load district boundaries GeoJSON (real ArcGIS boundaries, same file the map uses). city: 'stpaul' or 'mpls'."""
    filename = "boundaries_mpls.geojson" if city == "mpls" else "boundaries.geojson"
    boundaries_file = REPO_DIR / "web" / "public" / "data" / filename
    if not boundaries_file.exists():
        raise FileNotFoundError(f"Boundaries file not found: {boundaries_file}")
    with open(boundaries_file) as f:
        return json.load(f)

def load_crosswalk(crosswalk_file):
    """Load a JSON crosswalk file."""
    crosswalk_path = PIPELINE_DIR / crosswalk_file
    if not crosswalk_path.exists():
        raise FileNotFoundError(f"Crosswalk file not found: {crosswalk_path}")
    with open(crosswalk_path) as f:
        return json.load(f)

if __name__ == "__main__":
    print("Loading all datasets...")
    crime = load_crime()
    permits = load_permits()
    requests = load_requests()
    housing = load_housing()
    pop = load_population()
    boundaries = load_boundaries()

    print(f"[OK] Crime: {len(crime)} rows")
    print(f"[OK] Permits: {len(permits)} rows")
    print(f"[OK] Requests: {len(requests)} rows")
    print(f"[OK] Housing: {len(housing)} rows")
    print(f"[OK] Population: {len(pop)} districts")
    print(f"[OK] Boundaries: {len(boundaries.get('features', []))} features")
