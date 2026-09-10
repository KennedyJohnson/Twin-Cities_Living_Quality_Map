"""
Compute health scores based on aggregated metrics and config/weights.json.
Canonical formula:
  Safety_Index = 100 - normalize(crime_rate_pc)
  Opportunity_Index = normalize(permit_rate_pc)
  QoL_Index = 100 - normalize(request_rate_pc + housing_rate_pc)
  Health_Score = 0.40*Safety + 0.30*Opportunity + 0.30*QoL
"""

import json
import pandas as pd
import numpy as np
from pathlib import Path

PIPELINE_DIR = Path(__file__).parent

def load_weights():
    """Load config/weights.json."""
    weights_file = PIPELINE_DIR / "config" / "weights.json"
    with open(weights_file) as f:
        return json.load(f)

def load_sources():
    """Load config/sources.json."""
    sources_file = PIPELINE_DIR / "config" / "sources.json"
    with open(sources_file) as f:
        return json.load(f)

def min_max_normalize(values):
    """
    Normalize values to (0, 100) using z-score + logistic squashing.

    Min-max normalization pins the single most extreme district to exactly
    0 or 100, which overstates how much of an outlier it really is. Z-score
    + logistic squashing scales by how many standard deviations a district
    is from the mean, then compresses to (0, 100) asymptotically - so
    extreme districts land near, but never exactly at, the floor/ceiling.
    """
    values = np.array(values, dtype=float)
    mean_val = np.mean(values)
    std_val = np.std(values)
    if std_val == 0:
        return np.full_like(values, 50.0, dtype=float)  # Edge case: all same value
    z_scores = (values - mean_val) / std_val
    return 100 / (1 + np.exp(-z_scores))

def compute_component_index(aggregated_metrics, component_name, sources_config):
    """
    Compute a component index (e.g., Safety, Opportunity, QoL).

    Args:
        aggregated_metrics: dict of {source_id: {metric_name: ..., metrics: {district_id: ...}}}
        component_name: "safety", "opportunity", or "quality_of_life"
        sources_config: list of source entries from config/sources.json

    Returns:
        dict: {district_id: component_index_value (0-100)}
    """
    # Filter sources for this component
    component_sources = [s for s in sources_config if s["health_component"] == component_name]

    if not component_sources:
        return {}

    # Collect per-district values for this component
    component_values = {}  # {district_id: [values]}

    for source in component_sources:
        source_id = source["id"]
        rate_direction = source["rate_direction"]
        weight_in_component = source["weight_in_component"]

        if source_id not in aggregated_metrics:
            print(f"  [WARNING] {source_id} not in aggregated metrics")
            continue

        metrics = aggregated_metrics[source_id]["metrics"]

        for district_id, data in metrics.items():
            rate = data["rate_per_1000"]

            # Apply rate direction: "invert" means higher rate = lower score
            if rate_direction == "invert":
                rate = -rate

            if district_id not in component_values:
                component_values[district_id] = []

            component_values[district_id].append((rate, weight_in_component))

    # Normalize and blend
    all_rates = []
    for district_id, rates_and_weights in component_values.items():
        all_rates.extend([r for r, _ in rates_and_weights])

    if not all_rates:
        return {}

    normalized_rates = min_max_normalize(all_rates)

    # Rebuild with normalized values
    rate_idx = 0
    component_index = {}
    for district_id, rates_and_weights in component_values.items():
        weighted_sum = 0
        weight_sum = 0
        for _, weight in rates_and_weights:
            weighted_sum += normalized_rates[rate_idx] * weight
            weight_sum += weight
            rate_idx += 1
        component_index[district_id] = weighted_sum / weight_sum if weight_sum > 0 else 0

    return component_index

def compute_health_scores(aggregated_metrics):
    """
    Compute health scores for all districts.

    Args:
        aggregated_metrics: dict of aggregated data

    Returns:
        dict: {district_id: {safety: X, opportunity: Y, quality_of_life: Z, health_score: W}}
    """
    weights = load_weights()
    sources_config = load_sources()["sources"]

    # Compute component indices
    safety_index = compute_component_index(aggregated_metrics, "safety", sources_config)
    opportunity_index = compute_component_index(aggregated_metrics, "opportunity", sources_config)
    qol_index = compute_component_index(aggregated_metrics, "quality_of_life", sources_config)

    # Combine into health scores
    all_district_ids = set(safety_index.keys()) | set(opportunity_index.keys()) | set(qol_index.keys())

    health_scores = {}
    for district_id in sorted(all_district_ids):
        safety = safety_index.get(district_id, 0)
        opportunity = opportunity_index.get(district_id, 0)
        qol = qol_index.get(district_id, 0)

        health_score = (
            weights["health_score"]["components"]["safety"] * safety +
            weights["health_score"]["components"]["opportunity"] * opportunity +
            weights["health_score"]["components"]["quality_of_life"] * qol
        )

        health_scores[district_id] = {
            "indices": {
                "safety": round(safety, 2),
                "opportunity": round(opportunity, 2),
                "quality_of_life": round(qol, 2)
            },
            "health_score": round(health_score, 2)
        }

    return health_scores

if __name__ == "__main__":
    # For standalone testing: import aggregated metrics
    from aggregate import aggregate_all

    print("Computing health scores...")
    aggregated = aggregate_all()
    print()

    health_scores = compute_health_scores(aggregated)

    print()
    print("=" * 70)
    print("HEALTH SCORES")
    print("=" * 70)
    for district_id in sorted(health_scores.keys()):
        scores = health_scores[district_id]
        indices = scores["indices"]
        print(f"District {district_id}:")
        print(f"  Safety: {indices['safety']}, Opportunity: {indices['opportunity']}, QoL: {indices['quality_of_life']}")
        print(f"  Health Score: {scores['health_score']}")
