"""Score validation runs against the committed district exports (no network/API key needed)."""
import numpy as np

from analysis.score_validation import validate as V


def test_partial_spearman_removes_confounder():
    rng = np.random.default_rng(0)
    z = rng.normal(size=200)
    x, y = z + 0.1 * rng.normal(size=200), z + 0.1 * rng.normal(size=200)
    assert V.partial_spearman(x, y, z) < 0.3 < np.corrcoef(x, y)[0, 1]


def test_rank_desc_best_is_one():
    assert list(V.rank_desc([10, 30, 20])) == [3, 1, 2]


def test_sensitivity_on_committed_data():
    rows = V.load_rows()
    s = V.sensitivity(rows, np.random.default_rng(0))
    assert len(s["districts"]) == len(rows) == 28
    assert 0 < s["spearman_p5"] <= s["spearman_mean"] <= 1
    for d in s["districts"]:
        assert 1 <= d["rank_p5"] <= d["rank_median"] <= d["rank_p95"] <= 28
