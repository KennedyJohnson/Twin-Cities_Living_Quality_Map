"""
Orchestration script: load -> clean -> aggregate -> score -> output JSON.
Produces web/public/data/neighborhoods.json + boundaries.geojson for St. Paul,
and neighborhoods_mpls.json + boundaries_mpls.geojson for Minneapolis.
Includes a sanity check and smoke-test validation for each city.
"""

import json
import pandas as pd
from pathlib import Path
from core.aggregate import aggregate_all_combined, aggregate_all_zip
from core.health_score import compute_health_scores_combined, compute_health_scores_zip
from core.load import load_population, load_boundaries, load_zip_population, load_zip_boundaries
from core.radius_score import RadiusScoringContext
from cleaners.clean_apartment_buildings import clean_apartment_buildings
from exports.export_place_index import export_place_index
from exports.export_city_outline import export_city_outlines

PIPELINE_DIR = Path(__file__).parent
REPO_DIR = PIPELINE_DIR.parent
WEB_DATA_DIR = REPO_DIR / "web" / "public" / "data"

CITY_LABELS = {"stpaul": "ST. PAUL", "mpls": "MINNEAPOLIS"}


def build(city, aggregated, health_scores):
    """Build orchestration for a single city, from data already aggregated
    and scored across BOTH cities together (see core/health_score.py's
    compute_health_scores_combined — St. Paul and Minneapolis are
    normalized as one 28-district set so their scores are actually
    comparable, then split back out per-city here just for file output)."""
    label = CITY_LABELS.get(city, city.upper())
    neighborhoods_filename = "neighborhoods.json" if city == "stpaul" else f"neighborhoods_{city}.json"
    boundaries_filename = "boundaries.geojson" if city == "stpaul" else f"boundaries_{city}.geojson"

    print("=" * 70)
    print(f"TWIN CITIES LIVING QUALITY MAP - {label} BUILD PIPELINE")
    print("=" * 70)
    print()

    # Step 3: Load supporting data
    print("STEP 3: Loading population and boundaries...")
    print("-" * 70)
    population = load_population(city=city)
    boundaries = load_boundaries(city=city)
    print(f"[OK] Loaded {len(population)} districts, {len(boundaries['features'])} boundaries")
    print()

    # Step 4: Build neighborhoods.json
    print(f"STEP 4: Building {neighborhoods_filename}...")
    print("-" * 70)
    neighborhoods_data = []

    for _, pop_row in population.iterrows():
        district_id = int(pop_row["district_id"])
        district_name = pop_row["district_name"]
        pop_value = int(pop_row["population"])

        # Collect metrics for this district
        metrics = {}
        for source_id, source_data in aggregated.items():
            source_metrics = source_data["metrics"].get(district_id, {})
            if source_metrics:
                metric_name = source_data["metric_name"]
                metrics[metric_name] = source_metrics

        # Get health scores
        scores = health_scores.get(district_id, {})

        neighborhoods_data.append({
            "district_id": district_id,
            "district_name": district_name,
            "population": pop_value,
            "metrics": metrics,
            "indices": scores.get("indices", {}),
            "health_score": scores.get("health_score", None)
        })

    neighborhoods_json = {
        "neighborhoods": neighborhoods_data,
        "metadata": {
            "total_districts": len(neighborhoods_data),
            "data_generated": pd.Timestamp.now().isoformat(),
            "note": "Snapshot of all-time aggregated health metrics, normalized jointly across St. Paul and Minneapolis"
        }
    }

    # Write neighborhoods.json
    WEB_DATA_DIR.mkdir(parents=True, exist_ok=True)
    neighborhoods_file = WEB_DATA_DIR / neighborhoods_filename
    with open(neighborhoods_file, "w") as f:
        json.dump(neighborhoods_json, f, indent=2)
    print(f"[OK] Written {neighborhoods_file}")
    print()

    # Step 5: Prepare boundaries.geojson (ensure top-level "id")
    print(f"STEP 5: Preparing {boundaries_filename}...")
    print("-" * 70)
    for feature in boundaries["features"]:
        district_id = feature["properties"]["district_id"]
        feature["id"] = district_id  # Top-level id for google.maps.Data.getFeatureById
    boundaries_file = WEB_DATA_DIR / boundaries_filename
    with open(boundaries_file, "w") as f:
        json.dump(boundaries, f, indent=2)
    print(f"[OK] Written {boundaries_file}")
    print()

    # Step 6: Print sanity table
    print("STEP 6: Sanity check - health score table")
    print("-" * 70)
    sanity_rows = []
    for neighborhood in neighborhoods_data:
        row = {
            "District": neighborhood["district_id"],
            "Name": neighborhood["district_name"][:20],
            "Population": neighborhood["population"],
            "Safety": neighborhood["indices"].get("safety", "N/A"),
            "Opportunity": neighborhood["indices"].get("opportunity", "N/A"),
            "Amenities": neighborhood["indices"].get("amenities", "N/A"),
            "Health Score": neighborhood["health_score"]
        }
        sanity_rows.append(row)

    sanity_df = pd.DataFrame(sanity_rows)
    print(sanity_df.to_string(index=False))
    print()

    # Step 7: Smoke test - validate totals
    print("STEP 7: Smoke test - cross-check totals")
    print("-" * 70)

    # Count total records from each aggregated source, restricted to this
    # city's district_ids — `aggregated` is the combined 28-district dict,
    # shared across both cities' build() calls.
    city_district_ids = {int(d) for d in population["district_id"]}
    for source_id, source_data in aggregated.items():
        metrics = {d: m for d, m in source_data["metrics"].items() if d in city_district_ids}
        total_raw_count = sum(m.get("raw_count", 0) for m in metrics.values())
        print(f"  {source_id}: {total_raw_count} total records across {len(metrics)} districts")

    # Validate health scores are in [0, 100]
    scores_list = [n["health_score"] for n in neighborhoods_data if n["health_score"] is not None]
    if scores_list:
        min_score = min(scores_list)
        max_score = max(scores_list)
        print(f"  Health scores range: {min_score} - {max_score} (expected: 0-100)")
        if min_score < 0 or max_score > 100:
            print(f"  [WARNING] Scores outside [0, 100]!")
        else:
            print(f"  [OK] All scores within valid range")

    print()
    print("=" * 70)
    print(f"{label} BUILD COMPLETE")
    print("=" * 70)
    print()


def build_apartment_buildings(city):
    """Precompute a 1-mile-radius health score for every real apartment
    building OSM knows about in this city, so "Find Your Match" can
    recommend actual buildings instead of whole districts without scoring
    hundreds of points in the browser. Writes
    web/public/data/apartment_buildings_{city}.json: an array of
    {id, name, address, lat, lon, district_id, health_score, indices}.

    Uses the SAME 1-mile-radius scoring algorithm as a map-click "place"
    search (core/radius_score.py, ported from web/lib/radiusScore.ts), fed
    by the previous run's exported client data files (points/trails/tracts/
    baseline) — see radius_score.py's module docstring for why that's an
    acceptable staleness tradeoff. If those files aren't present yet (e.g. a
    fresh checkout before the first export run), buildings are skipped with
    a warning rather than failing the whole build."""
    label = CITY_LABELS.get(city, city.upper())
    filename = f"apartment_buildings_{city}.json"
    print(f"Building {filename}...")
    print("-" * 70)

    context = RadiusScoringContext(city)
    if not context.available:
        print(f"[WARNING] No radius baseline available yet for {label}; "
              f"skipping {filename} (run exports/export_all.py first, then re-run build.py)")
        print()
        return

    buildings = clean_apartment_buildings(city=city)
    if buildings.empty:
        print(f"[WARNING] No apartment buildings found for {label}; writing empty {filename}")
        (WEB_DATA_DIR / filename).write_text(json.dumps([]))
        print()
        return

    out = []
    for _, row in buildings.iterrows():
        scored = context.score_point(
            lat=float(row["lat"]),
            lon=float(row["lon"]),
            label=row["name"],
            containing_district_id=int(row["district_id"]),
        )
        if scored is None:
            continue
        address = row["address"]
        out.append({
            "id": row["id"],
            "name": row["name"],
            "address": address if isinstance(address, str) else None,
            "lat": float(row["lat"]),
            "lon": float(row["lon"]),
            "district_id": int(row["district_id"]),
            "health_score": scored["health_score"],
            "indices": scored["indices"],
        })

    WEB_DATA_DIR.mkdir(parents=True, exist_ok=True)
    out_file = WEB_DATA_DIR / filename
    with open(out_file, "w") as f:
        json.dump(out, f)
    print(f"[OK] Written {out_file} ({len(out)} buildings)")
    print()


def build_zip(aggregated_zip, health_scores_zip):
    """Build orchestration for the zip-level layer: every ZIP in the metro
    scored and normalized in ONE pool (not per city), for finer-than-
    district geographic comparison. Writes neighborhoods_zip.json and
    boundaries_zip.geojson."""
    print("=" * 70)
    print("TWIN CITIES LIVING QUALITY MAP - ZIP-LEVEL BUILD PIPELINE")
    print("=" * 70)
    print()

    print("STEP 1: Loading zip population and boundaries...")
    print("-" * 70)
    population = load_zip_population()
    boundaries = load_zip_boundaries()
    print(f"[OK] Loaded {len(population)} zips, {len(boundaries['features'])} boundaries")
    print()

    print("STEP 2: Building neighborhoods_zip.json...")
    print("-" * 70)
    neighborhoods_data = []
    for _, pop_row in population.iterrows():
        zip_id = int(pop_row["district_id"])
        metrics = {}
        for source_id, source_data in aggregated_zip.items():
            source_metrics = source_data["metrics"].get(zip_id, {})
            if source_metrics:
                metrics[source_data["metric_name"]] = source_metrics

        scores = health_scores_zip.get(zip_id, {})
        neighborhoods_data.append({
            "district_id": zip_id,
            "district_name": pop_row["district_name"],
            "population": int(pop_row["population"]),
            "metrics": metrics,
            "indices": scores.get("indices", {}),
            "health_score": scores.get("health_score", None)
        })

    neighborhoods_json = {
        "neighborhoods": neighborhoods_data,
        "metadata": {
            "total_districts": len(neighborhoods_data),
            "data_generated": pd.Timestamp.now().isoformat(),
            "note": "Zip-level snapshot: every ZIP in the metro normalized in one pool against every other ZIP, finer-grained than the district-level map"
        }
    }
    WEB_DATA_DIR.mkdir(parents=True, exist_ok=True)
    with open(WEB_DATA_DIR / "neighborhoods_zip.json", "w") as f:
        json.dump(neighborhoods_json, f, indent=2)
    print(f"[OK] Written {WEB_DATA_DIR / 'neighborhoods_zip.json'}")
    print()

    print("STEP 3: Preparing boundaries_zip.geojson...")
    print("-" * 70)
    for feature in boundaries["features"]:
        feature["id"] = feature["properties"]["district_id"]
    with open(WEB_DATA_DIR / "boundaries_zip.geojson", "w") as f:
        json.dump(boundaries, f)
    print(f"[OK] Written {WEB_DATA_DIR / 'boundaries_zip.geojson'}")
    print()

    scores_list = [n["health_score"] for n in neighborhoods_data if n["health_score"] is not None]
    if scores_list:
        print(f"  Zip health scores range: {min(scores_list)} - {max(scores_list)} (expected: 0-100)")
    print()
    print("=" * 70)
    print("ZIP-LEVEL BUILD COMPLETE")
    print("=" * 70)
    print()


if __name__ == "__main__":
    print("Aggregating both cities together for one pooled normalization...")
    print("-" * 70)
    aggregated = aggregate_all_combined()
    print()
    health_scores = compute_health_scores_combined(aggregated)
    print(f"[OK] Computed scores for {len(health_scores)} districts (both cities pooled)")
    print()

    build(city="stpaul", aggregated=aggregated, health_scores=health_scores)
    print()
    build(city="mpls", aggregated=aggregated, health_scores=health_scores)
    print()

    print("Precomputing apartment building radius scores for Find Your Match...")
    print("-" * 70)
    build_apartment_buildings(city="stpaul")
    build_apartment_buildings(city="mpls")

    print("Building named-place index for address search / map-click labeling...")
    print("-" * 70)
    export_place_index()
    print()

    print("Building dissolved city outlines (St. Paul / Minneapolis borders)...")
    print("-" * 70)
    export_city_outlines()
    print()

    print("Aggregating all ZIPs in the metro into one pooled normalization...")
    print("-" * 70)
    aggregated_zip = aggregate_all_zip()
    print()
    health_scores_zip = compute_health_scores_zip(aggregated_zip)
    print(f"[OK] Computed scores for {len(health_scores_zip)} zips (metro-wide pooled)")
    print()
    build_zip(aggregated_zip, health_scores_zip)

    print("Next steps:")
    print(f"1. Review neighborhoods*.json and boundaries*.geojson in {WEB_DATA_DIR}")
    print("2. Push to git: git add pipeline/ web/public/data/")
    print("3. Run Next.js dev server: cd web && npm run dev")
    print()
