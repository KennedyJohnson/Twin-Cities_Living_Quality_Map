"""
Compute health scores based on aggregated metrics and config/weights.json.
Canonical formula:
  Safety_Index = avg(100 - normalize(crime_rate_pc), 100 - normalize(crash_rate_pc), 100 - normalize(disaster_risk_pc), 100 - normalize(chronic_disease_pc))
  Opportunity_Index = avg(normalize(permit_rate_pc), 100 - normalize(unemployment_rate_pc), 100 - normalize(housing_inventory_pc))
  Amenities_Index = 0.85 * [100 - normalize(request_rate_pc) + normalize(housing_rate_pc + schools_pc + grocery_pc + restaurants_pc + healthcare_pc + entertainment_pc)] + 0.15 * normalize(broadband_rate)
  Transportation_Index = 0.7 * [normalize(trail_km_pc + transit_stops_pc) - normalize(traffic_vkm_pc)] + 0.3 * walk_score
  Affordability_Index = avg(100 - normalize(median_home_value), 100 - normalize(median_gross_rent), normalize(median_household_income), 100 - normalize(poverty_rate), 100 - normalize(housing_cost_burden_rate), normalize(homeownership_rate), 100 - normalize(gini_index))
  Health_Score = 0.20*Safety + 0.20*Opportunity + 0.20*Amenities + 0.20*Transportation + 0.20*Affordability
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
    # A single NaN here poisons mean/std for the WHOLE array, silently
    # turning every district/zip's normalized value NaN for this metric (and
    # from there, the component index and overall health_score) — this has
    # happened in practice from an upstream per-capita rate dividing by a
    # missing/zero population. Fail loudly here instead of writing NaN into
    # the exported JSON, where it's invalid JSON that silently breaks the
    # frontend's JSON.parse for the entire file (see aggregate.py's
    # NO_ZERO_FILL_SOURCES inner-join fix for one real cause of this).
    if np.isnan(values).any():
        raise ValueError(
            f"min_max_normalize received {np.isnan(values).sum()} NaN value(s) out of {len(values)} "
            "— check upstream per-capita rate calculations for a population of 0/NaN"
        )
    mean_val = np.mean(values)
    std_val = np.std(values)
    if std_val == 0:
        return np.full_like(values, 50.0, dtype=float)  # Edge case: all same value
    z_scores = (values - mean_val) / std_val
    return 100 / (1 + np.exp(-z_scores))

def compute_component_index(aggregated_metrics, component_name, sources_config):
    """
    Compute a component index (e.g., Safety, Opportunity, Amenities).

    Each source/metric is z-score-normalized to 0-100 INDEPENDENTLY, then
    the normalized (comparable-scale) values are weight-averaged per
    district. Previously all of a component's raw rates (e.g. crime rate
    per 1,000 alongside pedestrian-crash rate per 1,000) were pooled into
    one flat list and normalized together — since those rates differ by
    orders of magnitude, the mean/std was dominated by the largest-magnitude
    metric, so smaller metrics collapsed to a near-constant value (~0.2
    points of spread across all districts) regardless of their configured
    weight. That made e.g. Safety an almost pure function of crime rate,
    with crashes/disaster-risk/chronic-disease contributing noise, not
    signal. See Severity 2 in the pipeline fairness audit.

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

    # district_id -> list of (normalized_value, weight)
    component_values = {}

    for source in component_sources:
        source_id = source["id"]
        rate_direction = source["rate_direction"]
        weight_in_component = source["weight_in_component"]

        if source_id not in aggregated_metrics:
            print(f"  [WARNING] {source_id} not in aggregated metrics")
            continue

        metrics = aggregated_metrics[source_id]["metrics"]
        if not metrics:
            continue

        district_ids = list(metrics.keys())
        rates = [metrics[d]["rate_per_1000"] for d in district_ids]
        if rate_direction == "invert":
            rates = [-r for r in rates]

        # Normalized against every district that has this metric (pooled
        # across both cities when aggregated_metrics is the combined set).
        normalized = min_max_normalize(rates)

        for district_id, norm_value in zip(district_ids, normalized):
            component_values.setdefault(district_id, []).append((norm_value, weight_in_component))

    component_index = {}
    for district_id, values_and_weights in component_values.items():
        weighted_sum = sum(v * w for v, w in values_and_weights)
        weight_sum = sum(w for _, w in values_and_weights)
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
    return _affordability_index_from_df(df)


def compute_affordability_index_combined():
    """
    Same as compute_affordability_index, but pools St. Paul and Minneapolis
    districts into one normalization instead of normalizing each city
    against only itself (Severity 1 in the pipeline fairness audit).
    """
    from cleaners.clean_housing_price import clean_housing_price

    stpaul_df = clean_housing_price(city="stpaul")
    mpls_df = clean_housing_price(city="mpls")
    df = pd.concat([stpaul_df, mpls_df], ignore_index=True)
    return _affordability_index_from_df(df)


def _affordability_index_from_df(df):
    if df.empty:
        return {}

    home_values = df["median_home_value"].tolist()
    rents = df["median_gross_rent"].tolist()
    incomes = df["median_household_income"].tolist()
    poverty_rates = df["poverty_rate"].tolist()
    cost_burden_rates = df["housing_cost_burden_rate"].tolist()
    homeownership_rates = df["homeownership_rate"].tolist()
    gini_indices = df["gini_index"].tolist()

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
    gini_norm = normalized_or_none(gini_indices)

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
        if i in gini_norm:
            parts.append(100 - gini_norm[i])
        if parts:
            affordability_index[int(district_id)] = sum(parts) / len(parts)

    return affordability_index

def compute_affordability_index_zip():
    """
    Same as compute_affordability_index, but computed per ZIP and pooled
    into ONE normalization across every zip in the metro (not per city) —
    see compute_health_scores_zip. A zip is joined against each city's own
    county tracts separately (Ramsey for St. Paul, Hennepin for
    Minneapolis), so a boundary zip spanning both counties gets a row from
    each; those are averaged together rather than one overwriting the other.
    """
    from cleaners.clean_housing_price import clean_housing_price

    stpaul_df = clean_housing_price(city="stpaul", granularity="zip")
    mpls_df = clean_housing_price(city="mpls", granularity="zip")
    df = pd.concat([stpaul_df, mpls_df], ignore_index=True)
    df = df.groupby("district_id", as_index=False).mean(numeric_only=True)
    return _affordability_index_from_df(df)


def compute_broadband_index(city="stpaul"):
    """
    Compute a broadband/internet-access index per district from Census ACS
    data (share of households with an internet subscription). Higher = more
    households online.

    Returns:
        dict: {district_id: broadband_index_value (0-100)}
    """
    from cleaners.clean_housing_price import clean_housing_price

    df = clean_housing_price(city=city)
    return _broadband_index_from_df(df)


def compute_broadband_index_combined():
    """Same as compute_broadband_index, but pools both cities' districts into one normalization."""
    from cleaners.clean_housing_price import clean_housing_price

    stpaul_df = clean_housing_price(city="stpaul")
    mpls_df = clean_housing_price(city="mpls")
    df = pd.concat([stpaul_df, mpls_df], ignore_index=True)
    return _broadband_index_from_df(df)


def _broadband_index_from_df(df):
    if df.empty:
        return {}

    rates = df["broadband_rate"].tolist()
    valid_idx = [i for i, v in enumerate(rates) if v is not None and not pd.isna(v)]
    if not valid_idx:
        return {}
    normalized = min_max_normalize([rates[i] for i in valid_idx])
    norm_by_idx = dict(zip(valid_idx, normalized))

    return {
        int(df["district_id"].iloc[i]): norm_by_idx[i]
        for i in valid_idx
    }


def compute_broadband_index_zip():
    """Same as compute_broadband_index, but pooled across every zip in the metro."""
    from cleaners.clean_housing_price import clean_housing_price

    stpaul_df = clean_housing_price(city="stpaul", granularity="zip")
    mpls_df = clean_housing_price(city="mpls", granularity="zip")
    df = pd.concat([stpaul_df, mpls_df], ignore_index=True)
    df = df.groupby("district_id", as_index=False).mean(numeric_only=True)
    return _broadband_index_from_df(df)


def compute_health_scores(aggregated_metrics, city="stpaul"):
    """
    Compute health scores for all districts of a SINGLE city, normalized
    only against that city's own districts.

    Superseded by compute_health_scores_combined() for the real map/build
    pipeline (see Severity 1 in the pipeline fairness audit: a St. Paul
    district's "72" and a Minneapolis district's "72" aren't the same thing
    if each was normalized against only its own city). Kept for standalone
    single-city testing/debugging.

    Args:
        aggregated_metrics: dict of aggregated data
        city: 'stpaul' or 'mpls' — selects which sources config to score against

    Returns:
        dict: {district_id: {safety: X, opportunity: Y, amenities: Z, affordability: A, health_score: W}}
    """
    sources_config = load_sources(city=city)["sources"]

    safety_index = compute_component_index(aggregated_metrics, "safety", sources_config)
    opportunity_index = compute_component_index(aggregated_metrics, "opportunity", sources_config)
    qol_index = compute_component_index(aggregated_metrics, "amenities", sources_config)
    transportation_index = compute_component_index(aggregated_metrics, "transportation", sources_config)
    try:
        affordability_index = compute_affordability_index(city=city)
    except Exception as e:
        print(f"  [WARNING] Affordability index unavailable ({e}); excluding from health score")
        affordability_index = {}

    try:
        from core.walk_score import compute_walk_score
        walk_score_index = compute_walk_score(city=city)
    except Exception as e:
        print(f"  [WARNING] Walk score unavailable ({e}); Transportation will exclude it")
        walk_score_index = {}

    try:
        broadband_index = compute_broadband_index(city=city)
    except Exception as e:
        print(f"  [WARNING] Broadband index unavailable ({e}); Amenities will exclude it")
        broadband_index = {}

    return _assemble_health_scores(
        safety_index, opportunity_index, qol_index, transportation_index,
        affordability_index, walk_score_index, broadband_index
    )


def compute_health_scores_combined(aggregated_metrics_combined):
    """
    Compute health scores for all 28 districts (St. Paul + Minneapolis)
    pooled into ONE normalization, so scores and rankings are actually
    comparable across cities — this is the canonical scoring path used by
    build.py. See Severity 1 in the pipeline fairness audit.

    Uses sources.json as the canonical component/weight/direction config;
    both cities' source configs are verified identical in those fields
    (they only differ in cosmetic metric_name/label text and loader_module).

    Args:
        aggregated_metrics_combined: from aggregate.aggregate_all_combined()

    Returns:
        dict: {district_id: {indices: {...}, health_score: W}} for all 28 districts
    """
    sources_config = load_sources(city="stpaul")["sources"]

    safety_index = compute_component_index(aggregated_metrics_combined, "safety", sources_config)
    opportunity_index = compute_component_index(aggregated_metrics_combined, "opportunity", sources_config)
    qol_index = compute_component_index(aggregated_metrics_combined, "amenities", sources_config)
    transportation_index = compute_component_index(aggregated_metrics_combined, "transportation", sources_config)
    try:
        affordability_index = compute_affordability_index_combined()
    except Exception as e:
        print(f"  [WARNING] Affordability index unavailable ({e}); excluding from health score")
        affordability_index = {}

    try:
        from core.walk_score import compute_walk_score_combined
        walk_score_index = compute_walk_score_combined()
    except Exception as e:
        print(f"  [WARNING] Walk score unavailable ({e}); Transportation will exclude it")
        walk_score_index = {}

    try:
        broadband_index = compute_broadband_index_combined()
    except Exception as e:
        print(f"  [WARNING] Broadband index unavailable ({e}); Amenities will exclude it")
        broadband_index = {}

    return _assemble_health_scores(
        safety_index, opportunity_index, qol_index, transportation_index,
        affordability_index, walk_score_index, broadband_index
    )


def compute_health_scores_zip(aggregated_metrics_zip):
    """
    Compute health scores for every ZIP code in the metro, pooled into ONE
    normalization — mirrors compute_health_scores_combined() but at zip
    granularity, giving finer-than-district geographic comparison where
    every zip is scored directly against every other zip in both cities,
    not just the zips within its own city.

    Args:
        aggregated_metrics_zip: from aggregate.aggregate_all_zip()

    Returns:
        dict: {zip_id: {indices: {...}, health_score: W}}
    """
    sources_config = load_sources(city="stpaul")["sources"]

    safety_index = compute_component_index(aggregated_metrics_zip, "safety", sources_config)
    opportunity_index = compute_component_index(aggregated_metrics_zip, "opportunity", sources_config)
    qol_index = compute_component_index(aggregated_metrics_zip, "amenities", sources_config)
    transportation_index = compute_component_index(aggregated_metrics_zip, "transportation", sources_config)
    try:
        affordability_index = compute_affordability_index_zip()
    except Exception as e:
        print(f"  [WARNING] Affordability index unavailable ({e}); excluding from health score")
        affordability_index = {}

    try:
        from core.walk_score import compute_walk_score_zip
        walk_score_index = compute_walk_score_zip()
    except Exception as e:
        print(f"  [WARNING] Walk score unavailable ({e}); Transportation will exclude it")
        walk_score_index = {}

    try:
        broadband_index = compute_broadband_index_zip()
    except Exception as e:
        print(f"  [WARNING] Broadband index unavailable ({e}); Amenities will exclude it")
        broadband_index = {}

    return _assemble_health_scores(
        safety_index, opportunity_index, qol_index, transportation_index,
        affordability_index, walk_score_index, broadband_index
    )


def _assemble_health_scores(safety_index, opportunity_index, qol_index, transportation_index,
                             affordability_index, walk_score_index, broadband_index=None):
    weights = load_weights()

    # Walk/Bike Score: distance-decay amenity proximity + street-intersection
    # density + trail km, computed separately from the per-source pipeline
    # above (it needs point-level distances, not a district-level count).
    # Blended into Transportation (70% trail/transit/traffic-based index /
    # 30% walk score) and also surfaced standalone in `indices` so it can be
    # shown like a Zillow-style Walk Score badge.
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

    # Broadband/internet access: blended into Amenities at a minor weight
    # (0.15) alongside the existing service-request/housing/OSM-amenity
    # blend, the same pattern used for walk_score above.
    if broadband_index:
        blended_amenities = {}
        for district_id in set(qol_index) | set(broadband_index):
            base = qol_index.get(district_id)
            broadband = broadband_index.get(district_id)
            if base is not None and broadband is not None:
                blended_amenities[district_id] = 0.85 * base + 0.15 * broadband
            elif broadband is not None:
                blended_amenities[district_id] = broadband
            else:
                blended_amenities[district_id] = base
        qol_index = blended_amenities

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
            "safety": round(safety),
            "opportunity": round(opportunity),
            "amenities": round(qol),
            "transportation": round(transportation),
        }
        if affordability is not None:
            indices["affordability"] = round(affordability)
        if district_id in walk_score_index:
            indices["walkability_score"] = round(walk_score_index[district_id])
        if broadband_index and district_id in broadband_index:
            indices["broadband_score"] = round(broadband_index[district_id])

        health_scores[district_id] = {
            "indices": indices,
            "health_score": round(health_score)
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
