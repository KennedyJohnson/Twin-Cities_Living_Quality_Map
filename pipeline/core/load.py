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
    "housing": "https://services1.arcgis.com/9meaaHE3uiba0zr8/arcgis/rest/services/Housing_Production_Q3_2024/FeatureServer/73",
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
            # Map ArcGIS column names to expected format (API has typos: LATITUE, LONGITUTE, DISTRINCT)
            if "LATITUE" in df.columns and "LONGITUTE" in df.columns:
                df["Latitude"] = pd.to_numeric(df["LATITUE"], errors="coerce")
                df["Longtitude"] = pd.to_numeric(df["LONGITUTE"], errors="coerce")
            elif "PROPX" in df.columns and "PROPY" in df.columns:
                df["Longtitude"] = df["PROPX"]
                df["Latitude"] = df["PROPY"]

            # DISTRINCT (sic) is the real St. Paul district council number, 1-17
            if "DISTRINCT" in df.columns:
                df["District Council"] = pd.to_numeric(df["DISTRINCT"], errors="coerce")
            elif "District Council" not in df.columns:
                df["District Council"] = None

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
            # Map ArcGIS column names to expected format
            # Note: column names have typos (LATITUE, LONGITUTE)
            if "LATITUE" in df.columns and "LONGITUTE" in df.columns:
                df["Latitude"] = pd.to_numeric(df["LATITUE"], errors="coerce")
                df["Longtitude"] = pd.to_numeric(df["LONGITUTE"], errors="coerce")
            elif "PROPX" in df.columns and "PROPY" in df.columns:
                df["Longtitude"] = df["PROPX"]
                df["Latitude"] = df["PROPY"]

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
            # Coordinates come back as a {"x": lon, "y": lat} dict in the "geometry" column (outSR=4326)
            if "geometry" in df.columns:
                df["Longitude"] = df["geometry"].apply(lambda g: g.get("x") if isinstance(g, dict) else None)
                df["Latitude"] = df["geometry"].apply(lambda g: g.get("y") if isinstance(g, dict) else None)
            elif "PROPX" in df.columns and "PROPY" in df.columns:
                df["Longitude"] = df["PROPX"]
                df["Latitude"] = df["PROPY"]
            print(f"[OK] Loaded {len(df)} housing records from ArcGIS")
            return df
        else:
            print("[WARNING] Housing ArcGIS service returned no data. Falling back to CSV/GeoJSON.")
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
    Load population by district from Census API, aggregated via real tract
    centroids (TIGERweb) spatially joined to district boundaries.

    Uses the same proven tract-centroid approach as clean_housing_price.py
    rather than an approximate/even distribution.
    """
    from shapely.geometry import Point, shape

    print(f"[INFO] Attempting to load {city} population from Census API...")

    census_key = os.getenv("CENSUS_API_KEY")
    if not census_key:
        raise FileNotFoundError("CENSUS_API_KEY environment variable not set; population data unavailable")

    from core.http_cache import cached_get

    county_fips = "053" if city == "mpls" else "123"  # Hennepin vs Ramsey
    state_fips = "27"

    # 1. Fetch tract-level population from Census ACS
    acs_url = "https://api.census.gov/data/2022/acs/acs5"
    params = {
        "get": "B01003_001E",
        "for": "tract:*",
        "in": f"state:{state_fips} county:{county_fips}",
        "key": census_key,
    }
    response = cached_get(acs_url, params=params, timeout=60)
    response.raise_for_status()
    data = response.json()
    if len(data) < 2:
        raise FileNotFoundError("Census API returned no tract population data")

    header, rows = data[0], data[1:]
    acs_df = pd.DataFrame(rows, columns=header)
    acs_df["geoid"] = acs_df["state"] + acs_df["county"] + acs_df["tract"]
    acs_df["population"] = pd.to_numeric(acs_df["B01003_001E"], errors="coerce").fillna(0)

    # 2. Fetch real tract centroids from TIGERweb (not Census ACS geometry)
    tigerweb_url = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer/8/query"
    geo_params = {
        "where": f"STATE='{state_fips}' AND COUNTY='{county_fips}'",
        "outFields": "GEOID,CENTLAT,CENTLON",
        "returnGeometry": "false",
        "f": "json",
    }
    response = cached_get(tigerweb_url, params=geo_params, timeout=60)
    response.raise_for_status()
    geo_data = response.json()

    centroid_rows = []
    for f in geo_data.get("features", []):
        attrs = f["attributes"]
        centroid_rows.append({
            "geoid": attrs["GEOID"],
            "lat": float(attrs["CENTLAT"]),
            "lon": float(attrs["CENTLON"]),
        })
    centroids_df = pd.DataFrame(centroid_rows)
    if centroids_df.empty:
        raise FileNotFoundError("TIGERweb returned no tract centroids")

    tracts = acs_df.merge(centroids_df, on="geoid", how="inner")

    # 3. Spatially join tract centroids to district boundaries (district_id set by load_boundaries)
    boundaries = load_boundaries(city)
    boundary_map = {}
    name_map = {}
    name_field = "CommName" if city == "mpls" else "planningdistrictname"
    for feature in boundaries["features"]:
        props = feature["properties"]
        district_id = props["district_id"]
        boundary_map[district_id] = shape(feature["geometry"])
        name_map[district_id] = props.get(name_field) or f"District {district_id}"

    def find_district(row):
        point = Point(row["lon"], row["lat"])
        for district_id, polygon in boundary_map.items():
            if polygon.contains(point):
                return district_id
        return None

    tracts["district_id"] = tracts.apply(find_district, axis=1)
    tracts = tracts.dropna(subset=["district_id"])
    tracts["district_id"] = tracts["district_id"].astype(int)

    result = (
        tracts.groupby("district_id")["population"]
        .sum()
        .reset_index()
    )
    result["population"] = result["population"].astype(int)
    result["district_name"] = result["district_id"].map(name_map)

    if result.empty or len(result) < len(boundary_map):
        missing = set(boundary_map.keys()) - set(result["district_id"])
        print(f"[WARNING] Population missing for districts: {sorted(missing)}")

    print(f"[OK] Loaded {len(result)} districts with population from Census API")
    return result

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

        # Map the real district number field to district_id (must be int, never None)
        if "features" in boundaries and len(boundaries["features"]) > 0:
            first_props = boundaries["features"][0].get("properties", {})

            if city == "mpls":
                # Minneapolis communities - map name to fixed ID (101-111)
                community_to_id = {
                    "Calhoun Isle": 101, "Camden": 102, "Central": 103,
                    "Longfellow": 104, "Near North": 105, "Nokomis": 106,
                    "Northeast": 107, "Phillips": 108, "Powderhorn": 109,
                    "Southwest": 110, "University": 111,
                }
                for feature in boundaries["features"]:
                    comm_name = feature["properties"].get("CommName")
                    feature["properties"]["district_id"] = community_to_id.get(comm_name)
            else:
                # St. Paul District Councils - real field is "districtnumber" (1-17)
                if "districtnumber" in first_props:
                    for feature in boundaries["features"]:
                        feature["properties"]["district_id"] = int(feature["properties"]["districtnumber"])
                elif "district_id" not in first_props:
                    raise ValueError(
                        f"No known district number field found in ArcGIS response. "
                        f"Available fields: {list(first_props.keys())}"
                    )

            # Verify every feature has a valid int district_id before returning
            missing = [
                f["properties"].get("OBJECTID", "?")
                for f in boundaries["features"]
                if f["properties"].get("district_id") is None
            ]
            if missing:
                raise ValueError(f"{len(missing)} features have no district_id after mapping")

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
    Load a neighborhood->district crosswalk from a local JSON reference file.

    St. Paul's crime API returns no coordinates (NEIGHBORHOOD_NAME only,
    confirmed via direct API inspection), so this mapping cannot be derived
    dynamically — it is maintained as a static reference file instead,
    same as Minneapolis's neighborhood->community crosswalk.
    """
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
