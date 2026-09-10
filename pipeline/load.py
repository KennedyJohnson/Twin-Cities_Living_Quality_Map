"""
Load raw data files (CSV/GeoJSON) into memory.
Returns DataFrames for each dataset with minimal processing.
"""

import pandas as pd
import json
from pathlib import Path

PIPELINE_DIR = Path(__file__).parent
REPO_DIR = PIPELINE_DIR.parent

def load_crime():
    """Load Crime Incident Report CSV."""
    crime_file = REPO_DIR / "data" / "Crime_Incident_Report.csv"
    if not crime_file.exists():
        raise FileNotFoundError(f"Crime file not found: {crime_file}")
    return pd.read_csv(crime_file)

def load_permits():
    """Load Building Permits CSV."""
    permits_file = REPO_DIR / "data" / "Approved_Building_Permits_-7890413957898939046.csv"
    if not permits_file.exists():
        raise FileNotFoundError(f"Permits file not found: {permits_file}")
    return pd.read_csv(permits_file)

def load_requests():
    """Load Service Requests CSV."""
    requests_file = REPO_DIR / "data" / "Resident_Service_Requests_7024824928576740068.csv"
    if not requests_file.exists():
        raise FileNotFoundError(f"Requests file not found: {requests_file}")
    return pd.read_csv(requests_file)

def load_housing():
    """Load Housing Production CSV/GeoJSON."""
    # Try CSV first
    housing_csv = REPO_DIR / "data" / "Housing_Production.csv"
    if housing_csv.exists():
        return pd.read_csv(housing_csv)

    # Try GeoJSON
    housing_geojson = REPO_DIR / "data" / "Housing_Production.geojson"
    if housing_geojson.exists():
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

    raise FileNotFoundError(f"Housing file not found (tried .csv and .geojson)")

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
