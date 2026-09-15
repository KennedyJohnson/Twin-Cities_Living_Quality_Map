"""
Per-point 1-mile-radius health-score scoring, ported from
web/lib/radiusScore.ts (computeRadiusNeighborhood) so a location scored here
in Python (e.g. an apartment building, precomputed at build time) lands on
the exact same 0-100 scale as a location scored client-side when a user
clicks the map in "place" mode.

Reuses the already-exported client data files rather than re-deriving raw
cleaner output:
  - web/public/data/radius_baseline_{city}.json  (mean/std/weight stats,
    written by pipeline/exports/export_radius_baseline.py)
  - web/public/data/points_{city}.json           (point geometry, written by
    pipeline/exports/export_points.py)
  - web/public/data/lines_trails.json            (trail geometry, same export)
  - web/public/data/tracts_affordability_{city}.json (Census tract centroids,
    written by pipeline/exports/export_tracts_affordability.py)

These files are regenerated weekly by exports/export_all.py, which runs
*after* build.py in the refresh workflow, so a RadiusScoringContext built
during build.py reads the previous run's copies (already committed to the
repo) — a small, acceptable staleness, the same tradeoff already implicit in
any pipeline step that reads one of its own prior outputs. If a file is
missing entirely (e.g. a fresh checkout before the first export run),
scoring degrades gracefully to an empty/unavailable result rather than
raising.
"""

import sys
from pathlib import Path as _BootstrapPath
sys.path.insert(0, str(_BootstrapPath(__file__).resolve().parent.parent))


import json
import math
from pathlib import Path

PIPELINE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = PIPELINE_DIR.parent / "web" / "public" / "data"

RADIUS_METERS = 1609.34
RADIUS_MILES = 1.0
CIRCLE_AREA_SQMI = math.pi * RADIUS_MILES * RADIUS_MILES

# Mirrors SOURCE_ID_ALIASES in web/lib/radiusScore.ts / export_radius_baseline.py.
SOURCE_ID_ALIASES = {"trails": "walkability"}


def _haversine_meters(lat1, lon1, lat2, lon2):
    r = 6371000.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(a)))


def logistic_normalize(value, mean, std):
    if not std:
        return 50.0
    z = (value - mean) / std
    return 100.0 / (1.0 + math.exp(-z))


def _load_json(filename):
    path = DATA_DIR / filename
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text())
    except (json.JSONDecodeError, OSError):
        return None


def _load_points(city):
    data = _load_json(f"points_{city}.json")
    if not data:
        return []
    points = []
    for feature in data.get("features", []):
        coords = (feature.get("geometry") or {}).get("coordinates")
        source = (feature.get("properties") or {}).get("source")
        if not coords or not source:
            continue
        lon, lat = coords[0], coords[1]
        points.append((source, lat, lon))
    return points


def _load_trails():
    data = _load_json("lines_trails.json")
    if not data:
        return []
    trails = []
    for feature in data.get("features", []):
        coords = (feature.get("geometry") or {}).get("coordinates")
        source = (feature.get("properties") or {}).get("source")
        if not coords or not source:
            continue
        latlngs = [(c[1], c[0]) for c in coords]
        trails.append((source, latlngs))
    return trails


def _load_tracts(city):
    data = _load_json(f"tracts_affordability_{city}.json")
    if not data:
        return []
    return data.get("tracts", [])


def _compute_component_index(lat, lon, component, points, trails, tracts):
    metrics = {}
    weighted_sum = 0.0
    weight_sum = 0.0

    for source in component.get("sources", []):
        weight = source.get("weight_in_component", 0.0)

        if source.get("geometry_type") == "tract":
            # Population-weighted average of a Census-tract field (e.g.
            # chronic disease prevalence, FEMA hazard risk) across tracts
            # within the radius — same treatment as _compute_affordability,
            # since these are already rates/scores, not point counts to sum.
            tract_field = source.get("tract_field")
            valid = [
                t for t in tracts
                if t.get(tract_field) is not None and t.get("population")
                and _haversine_meters(lat, lon, t["lat"], t["lon"]) <= RADIUS_METERS
            ]
            total_pop = sum(t["population"] for t in valid)
            value = (sum(t[tract_field] * t["population"] for t in valid) / total_pop) if total_pop else None
            if value is None:
                metrics[source["metric_name"]] = {"raw_count": len(valid), "rate_per_1000": 0.0}
                continue
            signed_rate = -value if source.get("rate_direction") == "invert" else value
            normalized = logistic_normalize(signed_rate, source.get("mean", 0.0), source.get("std", 0.0))
            weighted_sum += normalized * weight
            weight_sum += weight
            metrics[source["metric_name"]] = {"raw_count": len(valid), "rate_per_1000": round(value, 2)}
            continue

        raw_count = 0.0
        if source.get("geometry_type") == "line":
            for trail_source, latlngs in trails:
                if SOURCE_ID_ALIASES.get(trail_source, trail_source) != source["id"]:
                    continue
                for i in range(len(latlngs) - 1):
                    a_lat, a_lon = latlngs[i]
                    b_lat, b_lon = latlngs[i + 1]
                    if (_haversine_meters(lat, lon, a_lat, a_lon) <= RADIUS_METERS and
                            _haversine_meters(lat, lon, b_lat, b_lon) <= RADIUS_METERS):
                        raw_count += _haversine_meters(a_lat, a_lon, b_lat, b_lon) / 1000.0  # km
        else:
            for point_source, plat, plon in points:
                if point_source == source["id"] and _haversine_meters(lat, lon, plat, plon) <= RADIUS_METERS:
                    raw_count += 1

        per_sqmi = raw_count / CIRCLE_AREA_SQMI
        signed_rate = -per_sqmi if source.get("rate_direction") == "invert" else per_sqmi
        normalized = logistic_normalize(signed_rate, source.get("mean", 0.0), source.get("std", 0.0))

        weighted_sum += normalized * weight
        weight_sum += weight

        metrics[source["metric_name"]] = {
            "raw_count": round(raw_count, 2),
            "rate_per_1000": round(per_sqmi, 2),
        }

    if weight_sum == 0:
        return None, metrics
    return weighted_sum / weight_sum, metrics


def _compute_affordability(lat, lon, fields, tracts):
    nearby = [t for t in tracts if _haversine_meters(lat, lon, t["lat"], t["lon"]) <= RADIUS_METERS]
    if not nearby:
        return None

    parts = []
    for field, baseline_field in fields.items():
        valid = [t for t in nearby if t.get(field) is not None and t.get("population")]
        if not valid:
            continue
        total_pop = sum(t["population"] for t in valid)
        if total_pop == 0:
            continue
        weighted_value = sum(t[field] * t["population"] for t in valid) / total_pop
        normalized = logistic_normalize(weighted_value, baseline_field.get("mean", 0.0), baseline_field.get("std", 0.0))
        parts.append(100 - normalized if baseline_field.get("direction") == "invert" else normalized)

    if not parts:
        return None
    return sum(parts) / len(parts)


def compute_radius_neighborhood(lat, lon, label, baseline, points, trails, tracts, containing_district_id=None):
    """Direct Python port of web/lib/radiusScore.ts's computeRadiusNeighborhood.
    Returns a Neighborhood-shaped dict (district_id, district_name, population,
    metrics, indices, health_score, is_radius, containing_district_id)."""
    all_metrics = {}
    component_values = {}

    for key, component in baseline.get("components", {}).items():
        value, metrics = _compute_component_index(lat, lon, component, points, trails, tracts)
        component_values[key] = value
        all_metrics.update(metrics)

    affordability = _compute_affordability(lat, lon, baseline.get("affordability_fields", {}), tracts)

    weights = baseline.get("health_score_weights", {})

    weighted = []
    for key, value in component_values.items():
        if value is not None and weights.get(key) is not None:
            weighted.append((value, weights[key]))
    if affordability is not None and weights.get("affordability") is not None:
        weighted.append((affordability, weights["affordability"]))

    total_weight = sum(w for _, w in weighted)
    health_score = (sum(v * w for v, w in weighted) / total_weight) if total_weight > 0 else 0.0

    nearby_tracts = [t for t in tracts if _haversine_meters(lat, lon, t["lat"], t["lon"]) <= RADIUS_METERS]
    population = sum((t.get("population") or 0) for t in nearby_tracts)

    indices = {}
    for key, value in component_values.items():
        if value is not None:
            indices[key] = round(value)
    if affordability is not None:
        indices["affordability"] = round(affordability)

    return {
        "district_id": -1,
        "district_name": label,
        "population": population,
        "metrics": all_metrics,
        "indices": indices,
        "health_score": round(health_score),
        "is_radius": True,
        "containing_district_id": containing_district_id,
    }


class RadiusScoringContext:
    """Loads one city's baseline + raw point/trail/tract data once, then
    scores many points cheaply (no re-reading/re-parsing JSON per point) —
    used to batch-score hundreds of apartment buildings in build.py."""

    def __init__(self, city):
        self.city = city
        self.baseline = _load_json(f"radius_baseline_{city}.json")
        self.points = _load_points(city)
        self.trails = _load_trails()
        self.tracts = _load_tracts(city)

    @property
    def available(self):
        return bool(self.baseline)

    def score_point(self, lat, lon, label="Point", containing_district_id=None):
        if not self.available:
            return None
        return compute_radius_neighborhood(
            lat, lon, label, self.baseline, self.points, self.trails, self.tracts,
            containing_district_id=containing_district_id,
        )
