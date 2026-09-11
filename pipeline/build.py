"""
Orchestration script: load -> clean -> aggregate -> score -> output JSON.
Produces web/public/data/neighborhoods.json + boundaries.geojson for St. Paul,
and neighborhoods_mpls.json + boundaries_mpls.geojson for Minneapolis.
Includes a sanity check and smoke-test validation for each city.
"""

import json
import pandas as pd
from pathlib import Path
from core.aggregate import aggregate_all
from core.health_score import compute_health_scores
from core.load import load_population, load_boundaries

PIPELINE_DIR = Path(__file__).parent
REPO_DIR = PIPELINE_DIR.parent
WEB_DATA_DIR = REPO_DIR / "web" / "public" / "data"

CITY_LABELS = {"stpaul": "ST. PAUL", "mpls": "MINNEAPOLIS"}


def build(city="stpaul"):
    """Build orchestration for a single city."""
    label = CITY_LABELS.get(city, city.upper())
    neighborhoods_filename = "neighborhoods.json" if city == "stpaul" else f"neighborhoods_{city}.json"
    boundaries_filename = "boundaries.geojson" if city == "stpaul" else f"boundaries_{city}.geojson"

    print("=" * 70)
    print(f"TWIN CITIES LIVING QUALITY MAP - {label} BUILD PIPELINE")
    print("=" * 70)
    print()

    # Step 1: Aggregate all data sources
    print("STEP 1: Aggregating data by district...")
    print("-" * 70)
    aggregated = aggregate_all(city=city)
    print()

    # Step 2: Compute health scores
    print("STEP 2: Computing health scores...")
    print("-" * 70)
    health_scores = compute_health_scores(aggregated, city=city)
    print(f"[OK] Computed scores for {len(health_scores)} districts")
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
            "note": "Snapshot of all-time aggregated health metrics"
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

    # Count total records from each aggregated source
    for source_id, source_data in aggregated.items():
        metrics = source_data["metrics"]
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


if __name__ == "__main__":
    build(city="stpaul")
    print()
    build(city="mpls")

    print("Next steps:")
    print(f"1. Review neighborhoods*.json and boundaries*.geojson in {WEB_DATA_DIR}")
    print("2. Push to git: git add pipeline/ web/public/data/")
    print("3. Run Next.js dev server: cd web && npm run dev")
    print()
