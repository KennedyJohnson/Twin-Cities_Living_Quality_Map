"""
Export a per-city normalization baseline so the frontend can score an
arbitrary 1-mile-radius circle (a "place" click) on a comparable 0-100 scale,
without shipping the entire pipeline's raw data to the browser.

IMPORTANT — a circle is NEVER compared to a district. Two fairness fixes
live here:

1. Circle-vs-circle, not circle-vs-district. A 1-mile-radius circle is
   compared to a dense grid of OTHER 1-mile-radius circles sampled across
   the same city (roughly every GRID_SPACING_MILES), not to whole-district
   averages. A district's average rate is diluted by its full area
   (sparse edges/parks/etc.), so almost any circle drawn over an actually
   dense part of town looked artificially good against it (e.g. Safety
   nearly always landing in the top few percent no matter where you
   clicked). Sampling a grid of same-sized circles and comparing a clicked
   circle against THAT distribution makes it an apples-to-apples
   comparison — both sides computed the same way, over the same size area,
   from the same underlying point data the client itself uses.

2. Each source is normalized INDEPENDENTLY, not pooled with other sources
   in the same component before normalizing. Pooling raw rates of very
   different magnitude (e.g. a crime rate of dozens per sq mi alongside a
   schools rate of a fraction per sq mi) into one shared mean/std lets the
   largest-magnitude source dominate, crushing the others toward a flat,
   near-constant value regardless of their configured weight — the exact
   "Severity 2" bug core/health_score.py's compute_component_index already
   documents fixing for district scoring. This mirrors that same fix for
   radius/place scoring: each source gets its own mean/std, sources are
   normalized to 0-100 independently, THEN weight-averaged.

A district's Safety score blends crime, pedestrian/cyclist crashes, chronic
disease burden, and natural hazard risk (config/sources.json). A circle's
Safety score now blends the same four: crime/crashes as point-count rates
(circle-vs-circle, per #1 above), and chronic disease / hazard risk as
Census-tract-level fields (tract-vs-tract within the same city, the same
population-weighted-average treatment already used for Affordability's
fields) — see _build_safety_tract_sources. Previously neither had a
client-side export, so a circle's Safety was crime-only: a much narrower,
noisier signal than a district's 4-source blend, which is a big part of why
circles looked so extreme.

Which point/line sources are included is discovered dynamically, not
hardcoded: this script reads the actual exported point/line files
(web/public/data/points_{city}.json, points_unassigned.json,
lines_trails.json) and checks which "source" tags actually appear there, so
a source with no raw geometry shipped to the client (permits, unemployment,
traffic — at whatever point that changes) is automatically left out, and any
NEW point/line export added in the future is automatically picked up here
with no code change required — as long as its "source" property matches the
corresponding id in sources.json (see SOURCE_ID_ALIASES below for the one
known exception). Sources that remain unavailable have their
weight-in-component redistributed across whichever sources for that
component ARE available, the same fallback pattern health_score.py already
uses when Affordability is unavailable for a district.

Note: the Walk/Bike Score blended into Transportation in health_score.py
(distance-decay amenity proximity + street-intersection density) is NOT
replicated here — it's a heavier computation that needs point-level
distances, not a simple per-area rate. Transportation for a radius is
therefore missing that 30% sub-blend; the frontend labels this explicitly.

Writes web/public/data/radius_baseline_{city}.json.

Run: python export_radius_baseline.py
"""

import sys
from pathlib import Path as _BootstrapPath
sys.path.insert(0, str(_BootstrapPath(__file__).resolve().parent.parent))


import json
import math
from pathlib import Path

import numpy as np
from scipy.spatial import cKDTree
from shapely.geometry import shape, Point
from shapely.ops import unary_union
from shapely.prepared import prep

from core.aggregate import load_config
from core.load import load_boundaries
from core.health_score import load_weights
from cleaners.clean_housing_price import clean_housing_price
from cleaners.clean_health import _fetch_places_tracts, CITY_COUNTY_NAME as HEALTH_COUNTY_NAME, MEASURES as HEALTH_MEASURES
from cleaners.clean_disaster_risk import _fetch_nri_tracts, CITY_COUNTY_NAME as RISK_COUNTY_NAME

PIPELINE_DIR = Path(__file__).resolve().parent.parent
OUT_DIR = PIPELINE_DIR.parent / "web" / "public" / "data"

# The map's point/line layers tag features with a "source" property used for
# icons/labels (see pointLayerColors.ts), which is usually but not always the
# same string as the matching sources.json health-score source id — bridge
# the known exceptions here. Extend this if a future export introduces
# another mismatched name; everything else is matched by id automatically.
SOURCE_ID_ALIASES = {"trails": "walkability"}

# sources.json source id -> the field name that source's data lands under in
# tracts_affordability_{city}.json / clean_housing_price_tracts (see
# export_tracts_affordability.py). These are the Safety sources that, like
# Affordability's fields, are Census-tract-level rather than point/line
# geometry — handled via tract population/area averaging, not a KDTree.
SAFETY_TRACT_FIELDS = {
    "health": "chronic_disease_prevalence",
    "disaster_risk": "disaster_risk_score",
}

MILES_PER_DEGREE_LAT = 69.0
RADIUS_MILES = 1.0
CIRCLE_AREA_SQMI = math.pi * RADIUS_MILES ** 2

# Spacing between sampled circle centers used to build each source's
# comparison distribution. Smaller = smoother/more accurate distribution but
# more KDTree queries; 0.25mi over a ~10x10mi city is under a thousand
# sample circles, which is fast (seconds, not minutes).
GRID_SPACING_MILES = 0.25

AFFORDABILITY_FIELDS = [
    "median_home_value", "median_gross_rent", "median_household_income",
    "poverty_rate", "housing_cost_burden_rate", "homeownership_rate",
]
# "invert" fields count DOWN toward the index (100 - normalized value);
# "direct" fields count straight up. Mirrors health_score.py:161-172.
AFFORDABILITY_DIRECTIONS = {
    "median_home_value": "invert",
    "median_gross_rent": "invert",
    "median_household_income": "direct",
    "poverty_rate": "invert",
    "housing_cost_burden_rate": "invert",
    "homeownership_rate": "direct",
}


def _haversine_km(lat1, lon1, lat2, lon2):
    r = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(a)))


def _load_json(filename):
    path = OUT_DIR / filename
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text())
    except (json.JSONDecodeError, OSError):
        return None


def _load_exported_points(city):
    """{source_id: [(lat, lon), ...]}, pooling this city's own points file
    with the unassigned-points file (edge-of-city points that fell outside
    every district polygon but are still real and reachable by a 1-mile
    circle near a city edge)."""
    by_source = {}
    for filename in (f"points_{city}.json", "points_unassigned.json"):
        data = _load_json(filename)
        if not data:
            continue
        for feature in data.get("features", []):
            coords = (feature.get("geometry") or {}).get("coordinates")
            source = (feature.get("properties") or {}).get("source")
            if not coords or not source:
                continue
            lon, lat = coords[0], coords[1]
            by_source.setdefault(source, []).append((lat, lon))
    return by_source


def _load_exported_trail_segments():
    """{source_id: [(mid_lat, mid_lon, length_km), ...]} — one row per trail
    segment, approximated by its midpoint for the radius-membership test
    (segments are already simplified/short, so midpoint-in-radius is a close
    stand-in for "both endpoints in radius", which is what the client uses)."""
    data = _load_json("lines_trails.json")
    if not data:
        return {}
    by_source = {}
    for feature in data.get("features", []):
        coords = (feature.get("geometry") or {}).get("coordinates")
        source = (feature.get("properties") or {}).get("source")
        if not coords or not source or len(coords) < 2:
            continue
        source_id = SOURCE_ID_ALIASES.get(source, source)
        for i in range(len(coords) - 1):
            lon1, lat1 = coords[i]
            lon2, lat2 = coords[i + 1]
            mid_lat = (lat1 + lat2) / 2
            mid_lon = (lon1 + lon2) / 2
            length_km = _haversine_km(lat1, lon1, lat2, lon2)
            by_source.setdefault(source_id, []).append((mid_lat, mid_lon, length_km))
    return by_source


def _sample_grid_points(boundaries, spacing_miles=GRID_SPACING_MILES):
    """A grid of (lat, lon) sample circle centers covering this city's own
    district area — the population of "other nearby circles" every clicked
    circle gets compared against. Returns (points, lat0, lon_scale), where
    lat0/lon_scale are the projection this city's KDTrees are built in."""
    polys = [shape(f["geometry"]) for f in boundaries["features"]]
    union = unary_union(polys)
    prepared = prep(union)
    minx, miny, maxx, maxy = union.bounds

    lat0 = (miny + maxy) / 2
    lon_scale = MILES_PER_DEGREE_LAT * math.cos(math.radians(lat0))
    lon_step = spacing_miles / lon_scale
    lat_step = spacing_miles / MILES_PER_DEGREE_LAT

    points = []
    lat = miny
    while lat <= maxy:
        lon = minx
        while lon <= maxx:
            if prepared.contains(Point(lon, lat)):
                points.append((lat, lon))
            lon += lon_step
        lat += lat_step
    return points, lat0, lon_scale


def _project(lat, lon, lat0, lon_scale):
    return (lon * lon_scale, lat * MILES_PER_DEGREE_LAT)


def _build_point_line_sources(city, sources_config):
    """Per-source (mean, std) built from a grid of sampled 1-mile circles,
    for every source backed by point/line geometry actually shipped to the
    client. Returns {component: [source_dict, ...]}."""
    boundaries = load_boundaries(city=city)
    result = {}

    grid_points, lat0, lon_scale = _sample_grid_points(boundaries)
    if not grid_points:
        return result
    grid_coords = np.array([_project(lat, lon, lat0, lon_scale) for lat, lon in grid_points])

    points_by_source = _load_exported_points(city)
    trail_segments_by_source = _load_exported_trail_segments()

    client_source_ids = {}
    for source_id in points_by_source:
        client_source_ids[source_id] = "point"
    for source_id in trail_segments_by_source:
        client_source_ids.setdefault(source_id, "line")

    point_trees = {
        source_id: cKDTree(np.array([_project(lat, lon, lat0, lon_scale) for lat, lon in latlons]))
        for source_id, latlons in points_by_source.items() if latlons
    }
    trail_trees = {}
    trail_lengths = {}
    for source_id, segs in trail_segments_by_source.items():
        if not segs:
            continue
        trail_trees[source_id] = cKDTree(
            np.array([_project(lat, lon, lat0, lon_scale) for lat, lon, _ in segs])
        )
        trail_lengths[source_id] = np.array([length for _, _, length in segs])

    for source in sources_config:
        source_id = source["id"]
        component = source["health_component"]
        geometry_type = client_source_ids.get(source_id)
        if geometry_type is None:
            continue

        if geometry_type == "point":
            tree = point_trees.get(source_id)
            if tree is None:
                continue
            counts = np.array([len(idxs) for idxs in tree.query_ball_point(grid_coords, r=RADIUS_MILES)], dtype=float)
        else:
            tree = trail_trees.get(source_id)
            if tree is None:
                continue
            lengths = trail_lengths[source_id]
            counts = np.array([
                lengths[idxs].sum() if len(idxs) else 0.0
                for idxs in tree.query_ball_point(grid_coords, r=RADIUS_MILES)
            ])

        rate_direction = source["rate_direction"]
        per_sqmi = counts / CIRCLE_AREA_SQMI
        signed_rates = -per_sqmi if rate_direction == "invert" else per_sqmi

        # Each source normalized independently against ITS OWN distribution
        # across the sampled circles — never pooled with other sources in
        # the component (see module docstring, fix #2).
        result.setdefault(component, []).append({
            "id": source_id,
            "metric_name": source["metric_name"],
            "weight_in_component": source["weight_in_component"],
            "rate_direction": rate_direction,
            "geometry_type": geometry_type,
            "mean": float(np.mean(signed_rates)),
            "std": float(np.std(signed_rates)),
        })

    return result


def _chronic_disease_tract_values(city):
    county_name = HEALTH_COUNTY_NAME[city]
    totals = {}
    for measure in HEALTH_MEASURES:
        df = _fetch_places_tracts(county_name, measure)
        for _, row in df.iterrows():
            totals[row["geoid"]] = totals.get(row["geoid"], 0.0) + row["prevalence_pct"]
    return list(totals.values())


def _disaster_risk_tract_values(city):
    county_name = RISK_COUNTY_NAME[city]
    df = _fetch_nri_tracts(county_name)
    return df["risk_score"].dropna().tolist() if not df.empty else []


_SAFETY_TRACT_VALUE_FETCHERS = {
    "health": _chronic_disease_tract_values,
    "disaster_risk": _disaster_risk_tract_values,
}


def _build_safety_tract_sources(city, sources_config):
    """Chronic disease / hazard risk are Census-tract-level, not point/line
    geometry — normalized the same way Affordability's fields already are
    (raw per-tract value, mean/std pooled across this city's own tracts),
    tract-vs-tract within the same city rather than vs. any district."""
    sources = []
    for source in sources_config:
        source_id = source["id"]
        if source_id not in SAFETY_TRACT_FIELDS:
            continue
        fetch_values = _SAFETY_TRACT_VALUE_FETCHERS[source_id]
        try:
            values = fetch_values(city)
        except Exception as e:
            print(f"[WARNING] {source_id} tract baseline failed for {city}: {e}")
            continue
        if not values:
            continue
        arr = np.array(values, dtype=float)
        sources.append({
            "id": source_id,
            "metric_name": source["metric_name"],
            "weight_in_component": source["weight_in_component"],
            "rate_direction": source["rate_direction"],
            "geometry_type": "tract",
            "tract_field": SAFETY_TRACT_FIELDS[source_id],
            "mean": float(np.mean(arr)),
            "std": float(np.std(arr)),
        })
    return sources


def _build_component_baselines(city, sources_config):
    all_components = sorted({s["health_component"] for s in sources_config})
    by_component = _build_point_line_sources(city, sources_config)

    safety_tract_sources = _build_safety_tract_sources(city, sources_config)
    if safety_tract_sources:
        by_component.setdefault("safety", []).extend(safety_tract_sources)

    components = {}
    for component in all_components:
        components[component] = {"sources": by_component.get(component, [])}
    return components


def _build_affordability_baseline(city):
    df = clean_housing_price(city=city)
    fields = {}
    for field in AFFORDABILITY_FIELDS:
        values = df[field].dropna().tolist()
        if not values:
            fields[field] = {"mean": 0.0, "std": 0.0, "direction": AFFORDABILITY_DIRECTIONS[field]}
            continue
        arr = np.array(values, dtype=float)
        fields[field] = {
            "mean": float(np.mean(arr)),
            "std": float(np.std(arr)),
            "direction": AFFORDABILITY_DIRECTIONS[field],
        }
    return fields


def _export_city(city):
    sources_config = load_config(city=city)["sources"]
    weights = load_weights()

    return {
        "components": _build_component_baselines(city, sources_config),
        "affordability_fields": _build_affordability_baseline(city),
        "health_score_weights": weights["health_score"]["components"],
    }


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for city in ["stpaul", "mpls"]:
        print(f"Exporting {city} radius baseline...")
        try:
            data = _export_city(city)
        except Exception as e:
            print(f"[WARNING] Radius baseline export failed for {city}: {e}")
            continue
        (OUT_DIR / f"radius_baseline_{city}.json").write_text(json.dumps(data))
        print(f"[OK] wrote radius_baseline_{city}.json")


if __name__ == "__main__":
    main()
