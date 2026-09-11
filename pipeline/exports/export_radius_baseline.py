"""
Export a per-city normalization baseline so the frontend can score an
arbitrary 1-mile-radius circle (a "place" click) on a comparable 0-100 scale
to the district map, without shipping the entire pipeline's raw data to the
browser.

Which sources are included is discovered dynamically, not hardcoded: this
script reads the actual exported point/line files
(web/public/data/points_{city}.json, lines_trails.json) and checks which
"source" tags actually appear there per city, so a source with no raw
geometry shipped to the client (permits, requests, housing, unemployment,
traffic, chronic disease, disaster risk, at whatever point that changes) is
automatically left out, and any NEW point/line export added in the future
(e.g. if permits ever gets geocoded and added to export_points.py) is
automatically picked up here with no code change required — as long as its
"source" property matches the corresponding id in sources.json (see
SOURCE_ID_ALIASES below for the one known exception). Sources that remain
unavailable have their weight-in-component redistributed across whichever
sources for that component ARE available, the same fallback pattern
health_score.py already uses when Affordability is unavailable for a
district. Likewise, the set of health-score components (safety, opportunity,
amenities, transportation, ...) is read from sources.json's
health_component values rather than hardcoded, so a newly added component
is picked up automatically too.

Note: the Walk/Bike Score blended into Transportation in health_score.py
(distance-decay amenity proximity + street-intersection density) is NOT
replicated here — it's a heavier computation that needs point-level
distances, not a simple per-area rate. Transportation for a radius is
therefore missing that 30% sub-blend; the frontend labels this explicitly.

Since we don't have population for an arbitrary circle, circle rates are
per-square-mile rather than per-1,000-residents. To keep the 0-100 scale
comparable, this script recomputes the SAME z-score-then-logistic
normalization health_score.py does, but pooled across each city's own
districts' per-square-mile rates (not per-capita) — so a circle's rate is
compared to "how this city's own districts look on a per-area basis" for the
included sources, and to "how this city's own districts look on affordability"
for the Census fields.

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
from shapely.geometry import shape

from core.aggregate import aggregate_all, load_config
from core.load import load_boundaries
from core.health_score import load_weights
from cleaners.clean_housing_price import clean_housing_price

PIPELINE_DIR = Path(__file__).resolve().parent.parent
OUT_DIR = PIPELINE_DIR.parent / "web" / "public" / "data"

# The map's point/line layers tag features with a "source" property used for
# icons/labels (see pointLayerColors.ts), which is usually but not always the
# same string as the matching sources.json health-score source id — bridge
# the known exceptions here. Extend this if a future export introduces
# another mismatched name; everything else is matched by id automatically.
SOURCE_ID_ALIASES = {"trails": "walkability"}

MILES_PER_DEGREE_LAT = 69.0

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


def _district_area_sqmi(geometry):
    """Rough planar-projection area in square miles, adequate for a small
    city district at this latitude — not for anything continental in scale."""
    poly = shape(geometry)
    lat0 = poly.centroid.y
    lon_scale = MILES_PER_DEGREE_LAT * math.cos(math.radians(lat0))

    def to_miles(coords):
        return [(x * lon_scale, y * MILES_PER_DEGREE_LAT) for x, y in coords]

    from shapely.geometry import Polygon

    def polygon_area(poly_coords):
        exterior = to_miles(poly_coords[0])
        p = Polygon(exterior, [to_miles(hole) for hole in poly_coords[1:]])
        return p.area

    if geometry["type"] == "Polygon":
        return polygon_area(geometry["coordinates"])
    else:
        return sum(polygon_area(poly_coords) for poly_coords in geometry["coordinates"])


def _load_district_areas(city):
    boundaries = load_boundaries(city=city)
    areas = {}
    for feature in boundaries["features"]:
        district_id = feature["properties"]["district_id"]
        areas[district_id] = _district_area_sqmi(feature["geometry"])
    return areas


def _geometry_source_ids(city):
    """Which sources.json source ids actually have raw point/line geometry
    shipped to the client for this city, and whether that geometry is line
    (length-based, like trails) vs point (count-based) — read straight from
    the exported map-layer files rather than hardcoded, so a newly added
    point/line export (any source, any city) is picked up automatically next
    time this script runs, with zero code changes here.

    Returns: {source_id: "point" | "line"}
    """
    tags = {}
    for filename in (f"points_{city}.json", "lines_trails.json"):
        path = OUT_DIR / filename
        if not path.exists():
            continue
        try:
            data = json.loads(path.read_text())
        except (json.JSONDecodeError, OSError):
            continue
        for feature in data.get("features", []):
            source = feature.get("properties", {}).get("source")
            if not source:
                continue
            source_id = SOURCE_ID_ALIASES.get(source, source)
            geometry_type = "line" if feature.get("geometry", {}).get("type") == "LineString" else "point"
            tags[source_id] = geometry_type
    return tags


def _build_component_baselines(city, sources_config, areas):
    aggregated = aggregate_all(city=city)
    client_source_ids = _geometry_source_ids(city)

    # Discover components from sources.json itself (safety, opportunity,
    # amenities, transportation, and whatever gets added later) rather
    # than a hardcoded list, so a new component shows up automatically too.
    all_components = sorted({s["health_component"] for s in sources_config})

    # component -> list of signed per-sq-mi rates, pooled across all its
    # available sources x all districts (mirrors health_score.py's
    # min_max_normalize input pooling in compute_component_index).
    pooled = {component: [] for component in all_components}
    available_sources = {component: [] for component in all_components}

    for source in sources_config:
        source_id = source["id"]
        component = source["health_component"]

        if source_id not in client_source_ids:
            continue
        if source_id not in aggregated:
            continue

        geometry_type = client_source_ids[source_id]

        metrics = aggregated[source_id]["metrics"]
        rate_direction = source["rate_direction"]
        weight_in_component = source["weight_in_component"]

        signed_rates = []
        for district_id, data in metrics.items():
            area = areas.get(district_id)
            if not area:
                continue
            per_sqmi = data["raw_count"] / area
            signed_rates.append(-per_sqmi if rate_direction == "invert" else per_sqmi)

        if not signed_rates:
            continue

        pooled[component].extend(signed_rates)
        available_sources[component].append({
            "id": source_id,
            "metric_name": source["metric_name"],
            "weight_in_component": weight_in_component,
            "rate_direction": rate_direction,
            "geometry_type": geometry_type,
        })

    components = {}
    for component, rates in pooled.items():
        if not rates:
            components[component] = {"mean": 0.0, "std": 0.0, "sources": []}
            continue
        arr = np.array(rates, dtype=float)
        components[component] = {
            "mean": float(np.mean(arr)),
            "std": float(np.std(arr)),
            "sources": available_sources[component],
        }

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
    areas = _load_district_areas(city)
    weights = load_weights()

    return {
        "components": _build_component_baselines(city, sources_config, areas),
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
