"""
Sanity checks for the home value prediction analysis
(analysis/home_value_prediction). Only exercises train.py against the
already-committed data/panel.csv — no network calls or CENSUS_API_KEY
needed, so this runs in CI like the rest of pipeline/tests.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest
import numpy as np

from analysis.home_value_prediction.train import (
    load_transitions, forward_select_features, fit_final_lasso, evaluate,
)


@pytest.fixture(scope="module")
def transitions():
    return load_transitions()


def test_panel_has_expected_shape(transitions):
    # 8 years (2017-2024) of 28 districts gives 7 usable transitions.
    assert transitions["district_id"].nunique() == 28
    assert transitions["year"].nunique() == 7


def test_forward_selection_beats_naive_baseline(transitions):
    test_year = transitions["year"].max()
    train = transitions[transitions["year"] < test_year]
    test = transitions[transitions["year"] == test_year]

    selected, _ = forward_select_features(train, ["median_household_income", "poverty_rate", "gini_index"])
    assert len(selected) > 0

    model, scaler = fit_final_lasso(train, selected)
    metrics, _ = evaluate(model, scaler, test, selected, is_lasso=True)

    naive_rmse = float(np.sqrt(np.mean((test["label"] - train["label"].mean()) ** 2)))
    assert metrics["rmse"] < naive_rmse
