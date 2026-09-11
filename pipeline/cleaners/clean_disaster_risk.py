"""
Fetch tract-level natural hazard risk from FEMA's National Risk Index (NRI)
ArcGIS FeatureServer (free, no API key required) and convert to an
estimated at-risk-resident count per district, as a Safety signal — higher
composite risk lowers Safety.

Converting the tract's RISK_SCORE (0-100 composite across 18 hazards) into
a population-weighted count (RISK_SCORE x tract population) lets this plug
into the same count-based aggregate_by_source() pipeline as every other
source (summed per district, then divided by total district population
downstream) instead of needing special-cased handling.

NRI: https://hazards.fema.gov/nri/ (FeatureServer: National_Risk_Index_Census_Tracts)
"""

import sys
from pathlib import Path as _BootstrapPath
sys.path.insert(0, str(_BootstrapPath(__file__).resolve().parent.parent))


from core.http_cache import cached_get
import pandas as pd
from pathlib import Path
from shapely.geometry import Point, shape
from core.load import load_boundaries

PIPELINE_DIR = Path(__file__).resolve().parent.parent
NRI_FEATURE_SERVER = "https://services.arcgis.com/XG15cJAlne2vxtgt/arcgis/rest/services/National_Risk_Index_Census_Tracts/FeatureServer/0"

# County name (as used by the NRI's COUNTY field) per city
CITY_COUNTY_NAME = {
    "stpaul": "Ramsey",
    "mpls": "Hennepin",
}


def _fetch_nri_tracts(county_name):
    query_url = f"{NRI_FEATURE_SERVER}/query"
    params = {
        "where": f"STATEABBRV='MN' AND COUNTY='{county_name}'",
        "outFields": "TRACTFIPS,POPULATION,RISK_SCORE",
        "returnGeometry": "true",
        "outSR": 4326,
        "f": "json",
    }
    resp = cached_get(query_url, params=params, timeout=60)
    resp.raise_for_status()
    data = resp.json()

    records = []
    for feature in data.get("features", []):
        attrs = feature.get("attributes", {})
        geometry = feature.get("geometry")
        risk_score = attrs.get("RISK_SCORE")
        population = attrs.get("POPULATION")
        if not geometry or risk_score is None or population is None:
            continue
        try:
            polygon = shape({"type": "Polygon", "coordinates": geometry["rings"]})
            centroid = polygon.centroid
            records.append({
                "geoid": attrs.get("TRACTFIPS"),
                "lon": centroid.x,
                "lat": centroid.y,
                "risk_score": float(risk_score),
                "population": float(population),
            })
        except (ValueError, TypeError, KeyError):
            continue
    return pd.DataFrame(records)


def clean_disaster_risk(fallback_behavior="exclude_from_scoring_if_geography_fails", city="stpaul"):
    """
    Fetch FEMA NRI composite risk score per tract, convert to a
    population-weighted at-risk count, and join to districts via tract
    centroid point-in-polygon. city: 'stpaul' or 'mpls'.

    Returns:
        DataFrame with columns: geoid, district_id, value (population x
        risk score; aggregate_by_source() sums this per district)
    """
    county_name = CITY_COUNTY_NAME[city]

    try:
        tracts = _fetch_nri_tracts(county_name)
    except Exception as e:
        if fallback_behavior == "strict":
            raise
        print(f"[WARNING] FEMA NRI fetch failed ({e}); disaster_risk will be excluded from scoring")
        return pd.DataFrame(columns=["geoid", "district_id", "value"])

    if tracts.empty:
        if fallback_behavior == "strict":
            raise ValueError("No FEMA NRI data returned")
        return pd.DataFrame(columns=["geoid", "district_id", "value"])

    tracts["risk_weighted_count"] = tracts["risk_score"] * tracts["population"] / 100

    boundaries = load_boundaries(city=city)
    boundary_map = {}
    for feature in boundaries["features"]:
        district_id = feature["properties"]["district_id"]
        boundary_map[district_id] = shape(feature["geometry"])

    def find_district(row):
        point = Point(row["lon"], row["lat"])
        for district_id, polygon in boundary_map.items():
            if polygon.contains(point):
                return district_id
        return None

    tracts["district_id"] = tracts.apply(find_district, axis=1)
    tracts = tracts.dropna(subset=["district_id"])
    tracts["district_id"] = tracts["district_id"].astype(int)
    tracts["value"] = tracts["risk_weighted_count"]

    disaster_risk = tracts[["geoid", "district_id", "value"]]

    if disaster_risk.empty and fallback_behavior == "strict":
        raise ValueError("No FEMA NRI data could be joined to districts")

    return disaster_risk


if __name__ == "__main__":
    for city in ["stpaul", "mpls"]:
        cleaned = clean_disaster_risk(city=city)
        print(f"[OK] Cleaned disaster risk data for {city}: {len(cleaned)} tracts")
        totals = cleaned.groupby("district_id")["value"].sum().round(1)
        print(totals)
