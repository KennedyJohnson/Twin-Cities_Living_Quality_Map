"""
Unit tests for the health-score math in health_score.py. These test pure
functions/logic only — no network calls (Census/ArcGIS/Overpass) — so they
run fast and deterministically in CI.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest
import core.health_score as hs


def test_min_max_normalize_constant_values_returns_fifty():
    result = hs.min_max_normalize([10, 10, 10, 10])
    assert all(v == 50.0 for v in result)


def test_min_max_normalize_is_monotonic():
    result = hs.min_max_normalize([1, 5, 10, 50, 100])
    assert list(result) == sorted(result)


def test_min_max_normalize_stays_in_bounds():
    result = hs.min_max_normalize([-1000, -1, 0, 1, 1000])
    assert all(0 <= v <= 100 for v in result)


def test_min_max_normalize_mean_value_lands_at_fifty():
    values = [10, 20, 30, 40, 50]
    result = hs.min_max_normalize(values)
    mean_idx = values.index(30)
    assert result[mean_idx] == pytest.approx(50.0, abs=0.01)


def test_compute_component_index_direct_direction_preserves_order():
    aggregated_metrics = {
        "permits": {
            "metric_name": "permit_rate_pc",
            "metrics": {
                1: {"raw_count": 10, "rate_per_1000": 5.0},
                2: {"raw_count": 100, "rate_per_1000": 50.0},
            },
        }
    }
    sources_config = [
        {
            "id": "permits",
            "health_component": "opportunity",
            "rate_direction": "direct",
            "weight_in_component": 1.0,
        }
    ]
    index = hs.compute_component_index(aggregated_metrics, "opportunity", sources_config)
    # Higher raw rate ("direct") should score higher
    assert index[2] > index[1]


def test_compute_component_index_invert_direction_reverses_order():
    aggregated_metrics = {
        "crime": {
            "metric_name": "crime_rate_pc",
            "metrics": {
                1: {"raw_count": 10, "rate_per_1000": 5.0},
                2: {"raw_count": 100, "rate_per_1000": 50.0},
            },
        }
    }
    sources_config = [
        {
            "id": "crime",
            "health_component": "safety",
            "rate_direction": "invert",
            "weight_in_component": 1.0,
        }
    ]
    index = hs.compute_component_index(aggregated_metrics, "safety", sources_config)
    # Higher crime rate ("invert") should score lower (safer districts score higher)
    assert index[1] > index[2]


def test_compute_component_index_missing_source_returns_empty():
    index = hs.compute_component_index({}, "safety", [
        {"id": "crime", "health_component": "safety", "rate_direction": "invert", "weight_in_component": 1.0}
    ])
    assert index == {}


def test_compute_health_scores_blends_weighted_components(monkeypatch):
    monkeypatch.setattr(hs, "compute_affordability_index", lambda city="stpaul": {1: 80.0, 2: 20.0})

    aggregated_metrics = {
        "crime": {"metric_name": "crime_rate_pc", "metrics": {
            1: {"raw_count": 10, "rate_per_1000": 5.0},
            2: {"raw_count": 100, "rate_per_1000": 50.0},
        }},
        "permits": {"metric_name": "permit_rate_pc", "metrics": {
            1: {"raw_count": 10, "rate_per_1000": 5.0},
            2: {"raw_count": 100, "rate_per_1000": 50.0},
        }},
        "requests": {"metric_name": "request_rate_pc", "metrics": {
            1: {"raw_count": 10, "rate_per_1000": 5.0},
            2: {"raw_count": 100, "rate_per_1000": 50.0},
        }},
    }
    sources_config = hs.load_sources(city="stpaul")["sources"]
    # Only exercise sources present in our synthetic aggregated_metrics
    sources_config = [s for s in sources_config if s["id"] in aggregated_metrics]

    monkeypatch.setattr(hs, "load_sources", lambda city="stpaul": {"sources": sources_config})

    scores = hs.compute_health_scores(aggregated_metrics, city="stpaul")

    for district_id in (1, 2):
        assert 0 <= scores[district_id]["health_score"] <= 100
        assert "affordability" in scores[district_id]["indices"]

    # District 1 has lower crime (safer) and higher affordability than
    # district 2, so it should end up with a higher overall health score.
    assert scores[1]["health_score"] > scores[2]["health_score"]


def test_compute_health_scores_handles_missing_affordability(monkeypatch):
    monkeypatch.setattr(hs, "compute_affordability_index", lambda city="stpaul": {})

    aggregated_metrics = {
        "crime": {"metric_name": "crime_rate_pc", "metrics": {
            1: {"raw_count": 10, "rate_per_1000": 5.0},
        }},
    }
    sources_config = [
        {"id": "crime", "health_component": "safety", "rate_direction": "invert", "weight_in_component": 1.0},
    ]
    monkeypatch.setattr(hs, "load_sources", lambda city="stpaul": {"sources": sources_config})

    scores = hs.compute_health_scores(aggregated_metrics, city="stpaul")

    assert "affordability" not in scores[1]["indices"]
    assert 0 <= scores[1]["health_score"] <= 100
