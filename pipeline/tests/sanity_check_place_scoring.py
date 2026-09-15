"""
End-to-end sanity check for the "place" (1-mile radius click/search) scoring
system — the thing that broke silently before (Safety & Health clustering
near the top for nearly every click) with nothing catching it short of a
person clicking around the map and noticing.

Unlike pipeline/tests/test_health_score.py (unit tests of the district-level
normalization math), this exercises the actual radius-scoring path
(core/radius_score.py's RadiusScoringContext, fed by the real exported
points/trails/tracts/baseline files) against a dense grid of sample points
across each city, and flags distribution shapes that indicate a broken
comparison (everything clustered at one end, near-zero variance, NaNs) —
the same symptoms the circle-vs-district and pooled-normalization bugs
produced. Not a replacement for eyeballing the map, but catches the class of
bug that already happened once without needing a human to notice first.

Run after a build (needs web/public/data/radius_baseline_*.json,
points_*.json, tracts_affordability_*.json, boundaries*.geojson,
neighborhoods*.json to exist):

    cd pipeline
    python tests/sanity_check_place_scoring.py
"""

import sys
from pathlib import Path as _BootstrapPath
sys.path.insert(0, str(_BootstrapPath(__file__).resolve().parent.parent))

import json
import statistics
from pathlib import Path
from shapely.geometry import shape, Point

from core.radius_score import RadiusScoringContext
from exports.export_radius_baseline import _sample_grid_points, GRID_SPACING_MILES

PIPELINE_DIR = Path(__file__).resolve().parent.parent
WEB_DATA_DIR = PIPELINE_DIR.parent / "web" / "public" / "data"

INDEX_KEYS = ["safety", "opportunity", "amenities", "transportation", "affordability"]

# Opportunity's inputs (permits, unemployment) aren't shipped to the client
# for radius/place scoring at all (see radius_score.py's docstring / About
# page) — its weight is redistributed among the other components instead.
# So "no data for opportunity" here is an intentional, documented gap, not
# a regression to flag.
EXPECTED_MISSING_RADIUS_INDICES = {"opportunity"}

# If more than this fraction of sampled points land in the top 20 points of
# an index's 0-100 scale, that's the exact shape the circle-vs-district bug
# produced (nearly everywhere looked "top few percent").
TOP_HEAVY_FRACTION_THRESHOLD = 0.5
TOP_HEAVY_SCORE_THRESHOLD = 80

# An index whose sampled values barely spread out at all suggests the
# normalization collapsed to ~50 everywhere (the pooled-normalization bug) —
# real 1-mile circles across a whole city should show real variation.
LOW_VARIANCE_STD_THRESHOLD = 8


def _load_json(filename):
    path = WEB_DATA_DIR / filename
    if not path.exists():
        return None
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _load_boundaries(city):
    filename = "boundaries_mpls.geojson" if city == "mpls" else "boundaries.geojson"
    return _load_json(filename)


def _district_lookup(boundaries):
    """(district_id -> shapely polygon) for point-in-polygon district
    lookup, so sampled grid points can be compared against their own
    district's official score."""
    return {f["properties"]["district_id"]: shape(f["geometry"]) for f in boundaries["features"]}


def check_city(city):
    print(f"\n{'=' * 70}\n{city.upper()}\n{'=' * 70}")
    issues = []

    boundaries = _load_boundaries(city)
    if not boundaries:
        issues.append(f"[MISSING] No boundaries file for {city} — skipping.")
        print(issues[-1])
        return issues

    context = RadiusScoringContext(city)
    if not context.available:
        issues.append(f"[MISSING] No radius baseline for {city} (radius_baseline_{city}.json) — skipping.")
        print(issues[-1])
        return issues

    neighborhoods = _load_json(f"neighborhoods{'_' + city if city == 'mpls' else ''}.json")
    district_scores = {n["district_id"]: n["health_score"] for n in (neighborhoods or {}).get("neighborhoods", [])} \
        if isinstance(neighborhoods, dict) else \
        {n["district_id"]: n["health_score"] for n in (neighborhoods or [])}

    grid_points, _, _ = _sample_grid_points(boundaries)
    print(f"Sampling {len(grid_points)} grid points (every ~{GRID_SPACING_MILES}mi)...")

    district_polys = _district_lookup(boundaries)

    scores_by_key = {key: [] for key in ["health_score"] + INDEX_KEYS}
    nan_count = 0
    none_count = 0
    by_district_radius_scores = {}

    for lat, lon in grid_points:
        result = context.score_point(lat, lon, label="sanity-check")
        if result is None:
            none_count += 1
            continue

        health_score = result.get("health_score")
        if health_score is None or health_score != health_score:  # NaN check
            nan_count += 1
            continue

        scores_by_key["health_score"].append(health_score)
        for key in INDEX_KEYS:
            value = result.get("indices", {}).get(key)
            if value is not None and value == value:  # skip None/NaN
                scores_by_key[key].append(value)

        for district_id, poly in district_polys.items():
            if poly.contains(Point(lon, lat)):
                by_district_radius_scores.setdefault(district_id, []).append(health_score)
                break

    if none_count:
        issues.append(f"[WARN] {none_count}/{len(grid_points)} points returned no score at all.")
    if nan_count:
        issues.append(f"[FAIL] {nan_count}/{len(grid_points)} points produced a NaN health_score.")

    print(f"\n{'Metric':<18}{'n':>6}{'min':>8}{'mean':>8}{'median':>8}{'max':>8}{'std':>8}   top-heavy?")
    for key, values in scores_by_key.items():
        if not values:
            if key in EXPECTED_MISSING_RADIUS_INDICES:
                print(f"{key:<18} -- no data (expected: not shipped client-side for radius scoring) --")
            else:
                issues.append(f"[FAIL] No valid values at all for {key}.")
                print(f"{key:<18} -- no data --")
            continue
        n = len(values)
        vmin, vmax = min(values), max(values)
        mean = statistics.mean(values)
        median = statistics.median(values)
        std = statistics.pstdev(values)
        top_heavy_frac = sum(1 for v in values if v >= TOP_HEAVY_SCORE_THRESHOLD) / n
        flag = ""
        if key != "health_score" and top_heavy_frac > TOP_HEAVY_FRACTION_THRESHOLD:
            flag = f"  <-- {top_heavy_frac:.0%} of points >= {TOP_HEAVY_SCORE_THRESHOLD}"
            issues.append(
                f"[FAIL] {city}/{key}: {top_heavy_frac:.0%} of sampled points score >= "
                f"{TOP_HEAVY_SCORE_THRESHOLD} — looks like the old circle-vs-district clustering bug."
            )
        # health_score is a weighted BLEND of several components, so its
        # variance is naturally compressed relative to any single component
        # (averaging several semi-independent ~15-std components produces a
        # ~4-6 std composite, not a bug) — only flag low variance on the
        # individual components themselves.
        if key != "health_score" and std < LOW_VARIANCE_STD_THRESHOLD:
            flag += f"  <-- std={std:.1f} (collapsed?)"
            issues.append(
                f"[WARN] {city}/{key}: std={std:.1f} across {n} points, suspiciously low — "
                "check for a pooled-normalization regression."
            )
        print(f"{key:<18}{n:>6}{vmin:>8.1f}{mean:>8.1f}{median:>8.1f}{vmax:>8.1f}{std:>8.1f}{flag}")

    # District-vs-radius consistency: a 1-mile circle's score shouldn't
    # routinely blow past its own district's official score by a huge
    # margin — some divergence is expected (radius scoring is a different,
    # finer-grained baseline), but a big systematic gap in one direction
    # suggests the two scoring paths have drifted apart again.
    if district_scores and by_district_radius_scores:
        diffs = []
        for district_id, radius_scores in by_district_radius_scores.items():
            official = district_scores.get(district_id)
            if official is None:
                continue
            avg_radius = statistics.mean(radius_scores)
            diffs.append(avg_radius - official)
        if diffs:
            mean_diff = statistics.mean(diffs)
            max_abs_diff = max(abs(d) for d in diffs)
            print(f"\nDistrict-vs-radius average health_score gap: mean={mean_diff:+.1f}, max|gap|={max_abs_diff:.1f}")
            if abs(mean_diff) > 15:
                issues.append(
                    f"[WARN] {city}: radius scores average {mean_diff:+.1f} vs. their own district's "
                    "official score — systematic bias, not just point-to-point noise."
                )

    return issues


def main():
    all_issues = []
    for city in ("stpaul", "mpls"):
        all_issues.extend(check_city(city))

    print(f"\n{'=' * 70}")
    if not all_issues:
        print("[OK] No issues found.")
    else:
        print(f"{len(all_issues)} issue(s) found:")
        for issue in all_issues:
            print(f"  {issue}")
    print("=" * 70)
    return 1 if any(i.startswith("[FAIL]") for i in all_issues) else 0


if __name__ == "__main__":
    sys.exit(main())
