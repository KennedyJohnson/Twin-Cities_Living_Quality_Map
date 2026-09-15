"""
Export a sampled distribution of 1-mile-radius ("place" click/search) scores,
so the frontend can grade a radius result (F/D/C/B/A) against other radius
results instead of against the district-level score distribution.

Why this exists: radius scores and district scores are computed differently
(radius mode has fewer client-side metrics available — Opportunity's
permits/unemployment and Walk/Bike Score's distance decay aren't shipped to
the browser, so their weight gets redistributed onto whatever remains) and
run on a visibly different scale — pipeline/tests/sanity_check_place_scoring.py
shows radius health_score averaging ~6 points below the same spot's district
score city-wide. Grading a radius result against the district distribution
(as web/components/NeighborhoodSidebar.tsx used to) means an ordinary radius
score routinely lands in D/F territory even inside a top-graded district,
which reads as broken even though the underlying numbers are fine — it's the
comparison pool that was wrong, not the score.

Reuses the same dense sample grid (~every 0.25mi within each city's own
district area) and RadiusScoringContext already validated by the sanity
check, so this file's distribution and that test's printed stats always
describe the same population.

Run: python export_radius_score_samples.py (after export_radius_baseline.py,
export_points.py, and export_tracts_affordability.py — see build.py)
"""

import sys
from pathlib import Path as _BootstrapPath
sys.path.insert(0, str(_BootstrapPath(__file__).resolve().parent.parent))


import json
from pathlib import Path

from core.radius_score import RadiusScoringContext
from exports.export_radius_baseline import _sample_grid_points

PIPELINE_DIR = Path(__file__).resolve().parent.parent
WEB_DATA_DIR = PIPELINE_DIR.parent / "web" / "public" / "data"

INDEX_KEYS = ["safety", "opportunity", "amenities", "transportation", "affordability"]


def _load_boundaries(city):
    filename = "boundaries_mpls.geojson" if city == "mpls" else "boundaries.geojson"
    path = WEB_DATA_DIR / filename
    if not path.exists():
        return None
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _sample_city(city):
    boundaries = _load_boundaries(city)
    if not boundaries:
        print(f"[WARNING] No boundaries file for {city} — skipping")
        return {}

    context = RadiusScoringContext(city)
    if not context.available:
        print(f"[WARNING] No radius baseline for {city} — skipping")
        return {}

    grid_points, _, _ = _sample_grid_points(boundaries)
    print(f"Sampling {len(grid_points)} {city} grid points for the radius-score baseline...")

    values_by_key = {key: [] for key in ["health_score"] + INDEX_KEYS}
    for lat, lon in grid_points:
        result = context.score_point(lat, lon, label="baseline-sample")
        if result is None:
            continue
        health_score = result.get("health_score")
        if health_score is not None and health_score == health_score:  # skip NaN
            values_by_key["health_score"].append(round(health_score, 2))
        for key in INDEX_KEYS:
            value = result.get("indices", {}).get(key)
            if value is not None and value == value:
                values_by_key[key].append(round(value, 2))
    return values_by_key


def main():
    combined = {key: [] for key in ["health_score"] + INDEX_KEYS}
    for city in ("stpaul", "mpls"):
        city_values = _sample_city(city)
        for key, values in city_values.items():
            combined[key].extend(values)

    out_path = WEB_DATA_DIR / "radius_score_samples.json"
    out_path.write_text(json.dumps(combined))
    for key, values in combined.items():
        print(f"[OK] {key}: {len(values)} sampled radius scores")
    print(f"[OK] Wrote {out_path}")


if __name__ == "__main__":
    main()
