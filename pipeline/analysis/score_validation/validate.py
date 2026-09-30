"""
Is the Living Quality Score robust, and does it line up with anything outside itself?

1. Weight sensitivity. The five components are weighted 20% each, a judgment call. Draw 5,000 alternative
   weightings from a Dirichlet distribution (alpha=4: each weight usually lands between ~5% and ~40%) and
   re-rank the 28 districts under each. Reports every district's rank range (5th-95th percentile), how well
   alternative rankings agree with the published one (Spearman), and how much dropping any one component moves
   the ranking.

2. External validation. If the score captures things people value, housing markets should price them in.
   Home value and rent are inputs to the Economic Profile component, so this uses the other four components only
   (a "non-price" score) and asks whether districts that score higher on them command higher home values and
   rents. Spearman correlations with permutation p-values (n=28, so a plain p-value alone would oversell it), plus
   a partial correlation controlling for household income, since richer areas both pay more and score higher.

Standalone (not part of build.py): reads the exported district JSONs in web/public/data/, writes results.json
here and a copy to web/public/data/score_validation.json.

    python -m analysis.score_validation.validate   (from pipeline/)
"""
import json
import shutil
from pathlib import Path

import numpy as np
from scipy.stats import rankdata, spearmanr

ROOT = Path(__file__).resolve().parents[3]
DATA = ROOT / "web" / "public" / "data"
OUT = Path(__file__).resolve().parent / "results.json"

COMPONENTS = ["safety", "opportunity", "amenities", "transportation", "affordability"]
NON_PRICE = COMPONENTS[:4]
OUTCOMES = {"median_home_value": "Median home value", "median_gross_rent": "Median rent"}
DRAWS, ALPHA, PERMS, SEED = 5000, 4.0, 10000, 0


def load_rows():
    rows = []
    for city, nb_file in (("stpaul", "neighborhoods.json"), ("mpls", "neighborhoods_mpls.json")):
        census = json.loads((DATA / f"affordability_{city}.json").read_text())["districts"]
        for d in json.loads((DATA / nb_file).read_text())["neighborhoods"]:
            c = census.get(str(d["district_id"]), {})
            rows.append({"id": d["district_id"], "name": d["district_name"], "city": city,
                         "score": d["health_score"], **{k: d["indices"][k] for k in COMPONENTS},
                         **{k: c.get(k) for k in [*OUTCOMES, "median_household_income"]}})
    return rows


def rank_desc(scores):
    """Rank 1 = best. Works on a vector or on each row of a matrix."""
    return rankdata(-np.asarray(scores), method="min", axis=-1)


def sensitivity(rows, rng):
    C = np.array([[r[k] for k in COMPONENTS] for r in rows], dtype=float)
    base = C.mean(axis=1)
    base_rank = rank_desc(base)
    W = rng.dirichlet([ALPHA] * len(COMPONENTS), DRAWS)
    ranks = rank_desc(W @ C.T)  # draws x districts
    rho = np.array([spearmanr(base, s).statistic for s in W @ C.T])
    districts = [{"id": r["id"], "name": r["name"], "city": r["city"], "rank": int(base_rank[i]),
                  "rank_p5": int(np.percentile(ranks[:, i], 5)), "rank_median": int(np.median(ranks[:, i])),
                  "rank_p95": int(np.percentile(ranks[:, i], 95))} for i, r in enumerate(rows)]
    districts.sort(key=lambda d: d["rank"])
    top = int(np.argmin(base_rank))
    drop_one = {}
    for j, k in enumerate(COMPONENTS):
        keep = [x for x in range(len(COMPONENTS)) if x != j]
        drop_one[k] = round(float(spearmanr(base, C[:, keep].mean(axis=1)).statistic), 3)
    return {
        "draws": DRAWS, "alpha": ALPHA,
        "spearman_mean": round(float(rho.mean()), 3), "spearman_p5": round(float(np.percentile(rho, 5)), 3),
        "top_district_stays_first": round(float((ranks[:, top] == 1).mean()), 3),
        "top5_share_in_top5": round(float(np.mean([(ranks[:, base_rank <= 5] <= 5).mean()])), 3),
        "median_rank_band": int(np.median([d["rank_p95"] - d["rank_p5"] for d in districts])),
        "drop_one_component_spearman": drop_one,
        "districts": districts,
    }


def perm_p(x, y, rng):
    obs = spearmanr(x, y).statistic
    null = np.array([spearmanr(x, rng.permutation(y)).statistic for _ in range(PERMS)])
    return round(float(obs), 3), round(float((np.abs(null) >= abs(obs)).mean()), 4)


def partial_spearman(x, y, z):
    """Spearman correlation of x and y after removing the (rank) linear effect of z from both."""
    rx, ry, rz = (rankdata(v) for v in (x, y, z))
    res = lambda a: a - np.polyval(np.polyfit(rz, a, 1), rz)  # noqa: E731
    return round(float(np.corrcoef(res(rx), res(ry))[0, 1]), 3)


def external(rows, rng):
    ok = [r for r in rows if all(r[k] is not None for k in [*OUTCOMES, "median_household_income"])]
    nonprice = np.array([np.mean([r[k] for k in NON_PRICE]) for r in ok])
    income = np.array([r["median_household_income"] for r in ok], dtype=float)
    out = {"n": len(ok), "outcomes": []}
    for key, label in OUTCOMES.items():
        y = np.array([r[key] for r in ok], dtype=float)
        rho, p = perm_p(nonprice, y, rng)
        out["outcomes"].append({
            "outcome": key, "label": label, "spearman": rho, "perm_p": p,
            "partial_spearman_given_income": partial_spearman(nonprice, y, income),
            "by_component": {k: round(float(spearmanr([r[k] for r in ok], y).statistic), 3) for k in NON_PRICE},
        })
    return out


def main():
    rng = np.random.default_rng(SEED)
    rows = load_rows()
    result = {"n_districts": len(rows), "sensitivity": sensitivity(rows, rng), "external": external(rows, rng)}
    OUT.write_text(json.dumps(result, indent=1))
    shutil.copy(OUT, DATA / "score_validation.json")
    s, e = result["sensitivity"], result["external"]
    print(f"weights: mean Spearman {s['spearman_mean']} (p5 {s['spearman_p5']}), top stays #1 {s['top_district_stays_first']:.0%},"
          f" median 90% rank band {s['median_rank_band']}; drop-one {s['drop_one_component_spearman']}")
    for o in e["outcomes"]:
        print(f"{o['label']}: rho {o['spearman']} (perm p {o['perm_p']}), given income {o['partial_spearman_given_income']}, {o['by_component']}")


if __name__ == "__main__":
    main()
