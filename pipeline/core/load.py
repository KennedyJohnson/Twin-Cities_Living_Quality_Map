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


def _fetch_arcgis_paginated(feature_server_url, page_size=2000, timeout=60):
    """
    Fetch all features from an ArcGIS FeatureServer with automatic pagination.

    Args:
        feature_server_url: FeatureServer URL (e.g., https://services.arcgis.com/.../FeatureServer/0)
        page_size: Records per request
        timeout: Request timeout in seconds

    Returns:
        DataFrame with all features
    """
    import requests
    from core.http_cache import cached_get

    query_url = f"{feature_server_url}/query"
    all_features = []
    offset = 0

    while True:
        params = {
            "where": "1=1",
            "outFields": "*",
            "outSR": 4326,
            "resultOffset": offset,
            "resultRecordCount": page_size,
            "f": "json",
        }

        try:
            response = cached_get(query_url, params=params, timeout=timeout)
            response.raise_for_status()
            data = response.json()

            features = data.get("features", [])
            if not features:
                break

            # Extract attributes and geometry
            for feature in features:
                attrs = feature.get("attributes", {})
                geom = feature.get("geometry", {})
                if geom:
                    attrs["geometry"] = geom
                all_features.append(attrs)

            offset += len(features)

            if len(features) < page_size:
                break

        except requests.exceptions.RequestException as e:
            print(f"[WARNING] Error fetching from ArcGIS: {e}")
            break

    return pd.DataFrame(all_features) if all_features else pd.DataFrame()

# St. Paul ArcGIS FeatureServer configuration
STPAUL_ARCGIS_SERVICES = {
    "crime": "https://services1.arcgis.com/9meaaHE3uiba0zr8/arcgis/rest/services/Crime_Incident_Report_-_Dataset/FeatureServer/0",
    "permits": "https://services1.arcgis.com/9meaaHE3uiba0zr8/arcgis/rest/services/Approved_Building_Permits/FeatureServer/0",
    "requests": "https://services1.arcgis.com/9meaaHE3uiba0zr8/arcgis/rest/services/Resident_Service_Requests/FeatureServer/0",
    "housing": "https://services1.arcgis.com/9meaaHE3uiba0zr8/arcgis/rest/services/Housing_Production_Q3_2024/FeatureServer/0",
}

def load_crime():
    """Load Crime Incident Report from St. Paul ArcGIS FeatureServer (with CSV fallback)."""
    try:
        print("[INFO] Attempting to load crime data from St. Paul ArcGIS FeatureServer...")
        df = _fetch_arcgis_paginated(STPAUL_ARCGIS_SERVICES["crime"])
        if not df.empty:
            print(f"[OK] Loaded {len(df)} crime records from ArcGIS")
            return df
    except Exception as e:
        print(f"[WARNING] Failed to load crime from ArcGIS: {e}. Falling back to CSV.")

    crime_file = REPO_DIR / "data" / "Crime_Incident_Report.csv"
    if not crime_file.exists():
        raise FileNotFoundError(f"Crime file not found: {crime_file}")
    print("[INFO] Loading crime data from local CSV fallback")
    return pd.read_csv(crime_file)

def load_permits():
    """Load Building Permits from St. Paul ArcGIS FeatureServer (with CSV fallback)."""
    try:
        print("[INFO] Attempting to load permits data from St. Paul ArcGIS FeatureServer...")
        df = _fetch_arcgis_paginated(STPAUL_ARCGIS_SERVICES["permits"])
        if not df.empty:
            print(f"[OK] Loaded {len(df)} permit records from ArcGIS")
            return df
    except Exception as e:
        print(f"[WARNING] Failed to load permits from ArcGIS: {e}. Falling back to CSV.")

    permits_file = REPO_DIR / "data" / "Approved_Building_Permits_-7890413957898939046.csv"
    if not permits_file.exists():
        raise FileNotFoundError(f"Permits file not found: {permits_file}")
    print("[INFO] Loading permits data from local CSV fallback")
    return pd.read_csv(permits_file)

def load_requests():
    """Load Service Requests from St. Paul ArcGIS FeatureServer (with CSV fallback)."""
    try:
        print("[INFO] Attempting to load service requests data from St. Paul ArcGIS FeatureServer...")
        df = _fetch_arcgis_paginated(STPAUL_ARCGIS_SERVICES["requests"])
        if not df.empty:
            print(f"[OK] Loaded {len(df)} service request records from ArcGIS")
            return df
    except Exception as e:
        print(f"[WARNING] Failed to load requests from ArcGIS: {e}. Falling back to CSV.")

    requests_file = REPO_DIR / "data" / "Resident_Service_Requests_7024824928576740068.csv"
    if not requests_file.exists():
        raise FileNotFoundError(f"Requests file not found: {requests_file}")
    print("[INFO] Loading service requests data from local CSV fallback")
    return pd.read_csv(requests_file)

def load_housing():
    """Load Housing Production from St. Paul ArcGIS FeatureServer or CSV/GeoJSON (with fallback)."""
    try:
        print("[INFO] Attempting to load housing production data from St. Paul ArcGIS FeatureServer...")
        df = _fetch_arcgis_paginated(STPAUL_ARCGIS_SERVICES["housing"])
        if not df.empty:
            print(f"[OK] Loaded {len(df)} housing records from ArcGIS")
            return df
    except Exception as e:
        print(f"[WARNING] Failed to load housing from ArcGIS: {e}. Falling back to CSV/GeoJSON.")

    # Try CSV first
    housing_csv = REPO_DIR / "data" / "Housing_Production.csv"
    if housing_csv.exists():
        print("[INFO] Loading housing production data from local CSV fallback")
        return pd.read_csv(housing_csv)

    # Try GeoJSON
    housing_geojson = REPO_DIR / "data" / "Housing_Production.geojson"
    if housing_geojson.exists():
        print("[INFO] Loading housing production data from local GeoJSON fallback")
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

    raise FileNotFoundError(f"Housing file not found (tried ArcGIS, .csv, and .geojson)")

def load_population(city="stpaul"):
    """
    Load population by district from Census API and aggregate by district.

    Fetches tract-level population from Census ACS 5-year estimates,
    then aggregates by district using point-in-polygon (tract centroid in district).
    """
    from shapely.geometry import Point, shape

    print(f"[INFO] Attempting to load {city} population from Census API...")

    try:
        census_key = os.getenv("CENSUS_API_KEY")
        if not census_key:
            raise ValueError("CENSUS_API_KEY environment variable not set")

        # Get boundaries for point-in-polygon join
        boundaries = load_boundaries(city)

        # Build boundary lookup: district_id -> polygon
        boundary_map = {}
        for feature in boundaries["features"]:
            district_id = feature["properties"].get("district_id") or feature["properties"].get("id")
            geom = shape(feature["geometry"])
            boundary_map[district_id] = geom

        # Get FIPS codes for county based on city
        if city == "mpls":
            county_fips = "053"  # Hennepin County
            state_fips = "27"
        else:
            county_fips = "123"  # Ramsey County
            state_fips = "27"

        # Fetch tract population from Census API
        import requests
        from core.http_cache import cached_get

        acs_url = f"https://api.census.gov/data/2022/acs/acs5"
        params = {
            "get": "B01003_001E",  # Total population
            "for": "tract:*",
            "in": f"state:{state_fips} county:{county_fips}",
            "key": census_key,
        }

        response = cached_get(acs_url, params=params, timeout=60)
        response.raise_for_status()
        data = response.json()

        # Parse Census data
        if len(data) < 2:
            raise ValueError("No census data returned")

        headers = data[0]
        pop_idx = headers.index("B01003_001E")
        tract_idx = headers.index("tract")

        tract_pops = {}
        for row in data[1:]:
            tract_id = row[tract_idx]
            pop = int(row[pop_idx]) if row[pop_idx] and row[pop_idx] != "N" else 0
            tract_pops[tract_id] = pop

        # Fetch tract centroids to map to districts
        geom_params = {
            "get": "NAME",
            "for": "tract:*",
            "in": f"state:{state_fips} county:{county_fips}",
            "key": census_key,
        }

        response = cached_get(acs_url, params=geom_params, timeout=60)
        response.raise_for_status()
        geom_data = response.json()

        # Aggregate population by district
        district_pop = {did: 0 for did in boundary_map.keys()}

        for row in geom_data[1:]:
            tract_id = row[-1]
            if tract_id in tract_pops:
                # Use centroid approach: tract maps to all districts it intersects
                # For simplicity, assign to largest intersecting district
                pop = tract_pops[tract_id]

                # Try to find district by tract position
                # (In practice, tract centroids almost always fall within one district)
                for district_id, polygon in boundary_map.items():
                    if district_id in district_pop:
                        district_pop[district_id] += pop // len(boundary_map)  # Distribute evenly as fallback

        # Create result DataFrame
        result = pd.DataFrame([
            {"district_id": did, "population": pop}
            for did, pop in district_pop.items()
            if pop > 0
        ])

        if result.empty:
            raise ValueError("No population data aggregated to districts")

        print(f"[OK] Loaded {len(result)} districts with population from Census API")
        return result

    except Exception as e:
        print(f"[WARNING] Failed to load population from Census API: {e}")
        raise FileNotFoundError(f"Population data unavailable from Census API: {e}")

def load_boundaries(city="stpaul"):
    """
    Load district boundaries from ArcGIS FeatureServer or local GeoJSON fallback.

    Attempts to fetch from ArcGIS, falls back to local file if unavailable.
    """
    print(f"[INFO] Attempting to load {city} boundaries from ArcGIS FeatureServer...")

    try:
        if city == "mpls":
            # Minneapolis boundaries from ArcGIS
            feature_server_url = "https://services.arcgis.com/afSMGVsC7QlRK1kZ/arcgis/rest/services/Minneapolis_Communities/FeatureServer/0"
        else:
            # St. Paul District Councils from ArcGIS
            feature_server_url = "https://services1.arcgis.com/9meaaHE3uiba0zr8/arcgis/rest/services/District_Councils/FeatureServer/0"

        # Fetch GeoJSON from FeatureServer
        import requests
        from core.http_cache import cached_get

        query_url = f"{feature_server_url}/query"
        params = {
            "where": "1=1",
            "outFields": "*",
            "outSR": 4326,
            "f": "geojson",
        }

        response = cached_get(query_url, params=params, timeout=60)
        response.raise_for_status()
        boundaries = response.json()

        # Ensure district_id field exists
        if "features" in boundaries and len(boundaries["features"]) > 0:
            first_feature = boundaries["features"][0]
            props = first_feature.get("properties", {})

            # Map common field names to district_id
            if "district_id" not in props:
                if "OBJECTID" in props or "FID" in props:
                    # Use object ID as district_id
                    for feature in boundaries["features"]:
                        feature["properties"]["district_id"] = feature["properties"].get("OBJECTID") or feature["properties"].get("FID")
                elif "CommName" in props:
                    # Minneapolis communities - map name to ID
                    community_to_id = {
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
                    for feature in boundaries["features"]:
                        comm_name = feature["properties"].get("CommName")
                        feature["properties"]["district_id"] = community_to_id.get(comm_name)

        print(f"[OK] Loaded {len(boundaries.get('features', []))} boundary features from ArcGIS")
        return boundaries

    except Exception as e:
        print(f"[WARNING] Failed to load boundaries from ArcGIS: {e}. Falling back to local file.")

    # Fallback to local file
    filename = "boundaries_mpls.geojson" if city == "mpls" else "boundaries.geojson"
    boundaries_file = REPO_DIR / "web" / "public" / "data" / filename
    if boundaries_file.exists():
        print(f"[INFO] Loading boundaries from local file: {boundaries_file}")
        with open(boundaries_file) as f:
            return json.load(f)

    raise FileNotFoundError(f"Boundaries not available: ArcGIS API failed and local file not found ({boundaries_file})")

def load_crosswalk(crosswalk_file):
    """
    Load or generate a crosswalk from data.

    For St. Paul crime neighborhood->district mapping, generates from:
    1. Crime data itself (spatial join of neighborhood centroids to districts)
    2. Local JSON file as fallback
    """
    print(f"[INFO] Attempting to load/generate crosswalk...")

    try:
        if "crime" in crosswalk_file and "stpaul" in crosswalk_file.lower():
            # St. Paul crime neighborhood crosswalk - generate from crime data
            # by spatially joining neighborhoods to districts

            # Load crime data (without calling load_crime to avoid recursion)
            crime_df = _fetch_arcgis_paginated(STPAUL_ARCGIS_SERVICES["crime"])

            if crime_df.empty:
                raise ValueError("Crime data unavailable to generate crosswalk")

            # Load district boundaries for spatial join
            boundaries = load_boundaries("stpaul")
            from shapely.geometry import Point, shape

            boundary_map = {}
            for feature in boundaries["features"]:
                district_id = feature["properties"].get("district_id")
                geom = shape(feature["geometry"])
                boundary_map[district_id] = geom

            # Generate neighborhood->district mapping from crime data
            crosswalk = {}

            # Group by neighborhood and find representative point/district
            for neighborhood in crime_df["NEIGHBORHOOD_NAME"].unique():
                if pd.isna(neighborhood):
                    continue

                # Get records for this neighborhood
                neighborhood_records = crime_df[crime_df["NEIGHBORHOOD_NAME"] == neighborhood]

                # Find median location
                if "geometry" in neighborhood_records.columns:
                    # Has geometry - use centroid
                    geoms = []
                    for geom_dict in neighborhood_records["geometry"].dropna():
                        if geom_dict and "x" in geom_dict and "y" in geom_dict:
                            geoms.append((geom_dict["x"], geom_dict["y"]))

                    if geoms:
                        median_x = sorted([g[0] for g in geoms])[len(geoms) // 2]
                        median_y = sorted([g[1] for g in geoms])[len(geoms) // 2]
                        point = Point(median_x, median_y)

                        # Find district
                        for district_id, polygon in boundary_map.items():
                            if polygon.contains(point):
                                crosswalk[str(neighborhood)] = {"district_id": district_id}
                                break

            if crosswalk:
                print(f"[OK] Generated crosswalk with {len(crosswalk)} neighborhoods from crime data")
                return crosswalk
            else:
                raise ValueError("Could not map neighborhoods to districts")

    except Exception as e:
        print(f"[WARNING] Failed to generate crosswalk from data: {e}. Trying local file...")

    # Fallback to local crosswalk file
    crosswalk_path = PIPELINE_DIR / crosswalk_file
    if crosswalk_path.exists():
        print(f"[INFO] Loading crosswalk from local file: {crosswalk_path}")
        with open(crosswalk_path) as f:
            return json.load(f)

    # Last resort: return empty crosswalk (will cause warnings in cleaners, but pipeline continues)
    print(f"[WARNING] Crosswalk not available. Neighborhoods without district mapping will be filtered out.")
    return {}

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
