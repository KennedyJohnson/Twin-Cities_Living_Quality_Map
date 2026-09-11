"""
Compute health scores based on aggregated metrics and config/weights.json.
Canonical formula:
  Safety_Index = avg(100 - normalize(crime_rate_pc), 100 - normalize(crash_rate_pc), 100 - normalize(disaster_risk_pc), 100 - normalize(chronic_disease_pc))
  Opportunity_Index = avg(normalize(permit_rate_pc), 100 - normalize(unemployment_rate_pc), 100 - normalize(housing_inventory_pc))
  Amenities_Index = 100 - normalize(request_rate_pc) + normalize(housing_rate_pc + schools_pc + grocery_pc + restaurants_pc + healthcare_pc)
  Transportation_Index = 0.7 * [normalize(trail_km_pc + transit_stops_pc) - normalize(traffic_vkm_pc)] + 0.3 * walk_score
  Affordability_Index = avg(100 - normalize(median_home_value), 100 - normalize(median_gross_rent), normalize(median_household_income), 100 - normalize(poverty_rate), 100 - normalize(housing_cost_burden_rate), normalize(homeownership_rate))
  Health_Score = 0.35*Safety + 0.25*Opportunity + 0.10*Amenities + 0.10*Transportation + 0.20*Affordability
"""

import sys
from pathlib import Path as _BootstrapPath
sys.path.insert(0, str(_BootstrapPath(__file__).resolve().parent.parent))


import json
import pandas as pd
import numpy as np
from pathlib import Path

PIPELINE_DIR = Path(__file__).resolve().parent.parent

def load_weights():
    """Load config/weights.json."""
    weights_file = PIPELINE_DIR / "config" / "weights.json"
    with open(weights_file) as f:
        return json.load(f)

def load_sources(city="stpaul"):
    """Load sources config. city: 'stpaul' or 'mpls'."""
    filename = "sources_mpls.json" if city == "mpls" else "sources.json"
    sources_file = PIPELINE_DIR / "config" / filename
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
    Compute a component index (e.g., Safety, Opportunity, Amenities).

    Args:
        aggregated_metrics: dict of {source_id: {metric_name: ..., metrics: {district_id: ...}}}
        component_name: "safety", "opportunity", or "amenities"
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

def compute_affordability_index(city="stpaul"):
    """
    Compute the affordability index per district from Census ACS data:
    lower home values/rent/poverty rate and higher household income (each
    relative to other districts) raise this index.

    Returns:
        dict: {district_id: affordability_index_value (0-100)}
    """
    from cleaners.clean_housing_price import clean_housing_price

    df = clean_housing_price(city=city)
    if df.empty:
        return {}

    home_values = df["median_home_value"].tolist()
    rents = df["median_gross_rent"].tolist()
    incomes = df["median_household_income"].tolist()
    poverty_rates = df["poverty_rate"].tolist()
    cost_burden_rates = df["housing_cost_burden_rate"].tolist()
    homeownership_rates = df["homeownership_rate"].tolist()

    def normalized_or_none(values):
        valid_idx = [i for i, v in enumerate(values) if v is not None and not pd.isna(v)]
        if not valid_idx:
            return {}
        normalized = min_max_normalize([values[i] for i in valid_idx])
        return dict(zip(valid_idx, normalized))

    home_value_norm = normalized_or_none(home_values)
    rent_norm = normalized_or_none(rents)
    income_norm = normalized_or_none(incomes)
    poverty_norm = normalized_or_none(poverty_rates)
    cost_burden_norm = normalized_or_none(cost_burden_rates)
    homeownership_norm = normalized_or_none(homeownership_rates)

    affordability_index = {}
    for i, district_id in enumerate(df["district_id"]):
        parts = []
        if i in home_value_norm:
            parts.append(100 - home_value_norm[i])
        if i in rent_norm:
            parts.append(100 - rent_norm[i])
        if i in income_norm:
            parts.append(income_norm[i])
        if i in poverty_norm:
            parts.append(100 - poverty_norm[i])
        if i in cost_burden_norm:
            parts.append(100 - cost_burden_norm[i])
        if i in homeownership_norm:
            parts.append(homeownership_norm[i])
        if parts:
            affordability_index[int(district_id)] = sum(parts) / len(parts)

    return affordability_index

def compute_health_scores(aggregated_metrics, city="stpaul"):
    """
    Compute health scores for all districts.

    Args:
        aggregated_metrics: dict of aggregated data
        city: 'stpaul' or 'mpls' — selects which sources config to score against

    Returns:
        dict: {district_id: {safety: X, opportunity: Y, amenities: Z, affordability: A, health_score: W}}
    """
    weights = load_weights()
    sources_config = load_sources(city=city)["sources"]

    # Compute component indices
    safety_index = compute_component_index(aggregated_metrics, "safety", sources_config)
    opportunity_index = compute_component_index(aggregated_metrics, "opportunity", sources_config)
    qol_index = compute_component_index(aggregated_metrics, "amenities", sources_config)
    transportation_index = compute_component_index(aggregated_metrics, "transportation", sources_config)
    try:
        affordability_index = compute_affordability_index(city=city)
    except Exception as e:
        print(f"  [WARNING] Affordability index unavailable ({e}); excluding from health score")
        affordability_index = {}

    # Walk/Bike Score: distance-decay amenity proximity + street-intersection
    # density + trail km, computed separately from the per-source pipeline
    # above (it needs point-level distances, not a district-level count).
    # Blended into Transportation (70% trail/transit/traffic-based index /
    # 30% walk score) and also surfaced standalone in `indices` so it can be
    # shown like a Zillow-style Walk Score badge.
    try:
        from core.walk_score import compute_walk_score
        walk_score_index = compute_walk_score(city=city)
    except Exception as e:
        print(f"  [WARNING] Walk score unavailable ({e}); Transportation will exclude it")
        walk_score_index = {}

    if walk_score_index:
        blended_transportation = {}
        for district_id in set(transportation_index) | set(walk_score_index):
            base = transportation_index.get(district_id)
            walk = walk_score_index.get(district_id)
            if base is not None and walk is not None:
                blended_transportation[district_id] = 0.7 * base + 0.3 * walk
            elif walk is not None:
                blended_transportation[district_id] = walk
            else:
                blended_transportation[district_id] = base
        transportation_index = blended_transportation

    # Combine into health scores
    all_district_ids = (
        set(safety_index.keys())
        | set(opportunity_index.keys())
        | set(qol_index.keys())
        | set(transportation_index.keys())
        | set(affordability_index.keys())
    )

    component_weights = weights["health_score"]["components"]

    health_scores = {}
    for district_id in sorted(all_district_ids):
        safety = safety_index.get(district_id, 0)
        opportunity = opportunity_index.get(district_id, 0)
        qol = qol_index.get(district_id, 0)
        transportation = transportation_index.get(district_id, 0)
        affordability = affordability_index.get(district_id)

        # If affordability is unavailable for this district, redistribute
        # its weight across the other components proportionally rather than
        # silently treating it as 0 (which would unfairly tank the score).
        if affordability is None:
            active_weight = (
                component_weights["safety"] + component_weights["opportunity"] +
                component_weights["amenities"] + component_weights["transportation"]
            )
            health_score = (
                component_weights["safety"] * safety +
                component_weights["opportunity"] * opportunity +
                component_weights["amenities"] * qol +
                component_weights["transportation"] * transportation
            ) / active_weight * 1.0 if active_weight > 0 else 0
        else:
            health_score = (
                component_weights["safety"] * safety +
                component_weights["opportunity"] * opportunity +
                component_weights["amenities"] * qol +
                component_weights["transportation"] * transportation +
                component_weights["affordability"] * affordability
            )

        indices = {
            "safety": round(safety, 2),
            "opportunity": round(opportunity, 2),
            "amenities": round(qol, 2),
            "transportation": round(transportation, 2),
        }
        if affordability is not None:
            indices["affordability"] = round(affordability, 2)
        if district_id in walk_score_index:
            indices["walkability_score"] = round(walk_score_index[district_id], 2)

        health_scores[district_id] = {
            "indices": indices,
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
        print(f"  Safety: {indices['safety']}, Opportunity: {indices['opportunity']}, Amenities: {indices['amenities']}")
        print(f"  Health Score: {scores['health_score']}")
