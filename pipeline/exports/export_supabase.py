"""Append this refresh's district + ZIP scores to Supabase score history.

Reads the already-written web/public/data exports (so it must run after
build.py and export_all.py) and inserts one refresh_runs row plus one
area_snapshots row per district/ZIP. Schema:
supabase/migrations/20260923000000_score_history.sql.

Needs SUPABASE_URL and SUPABASE_SECRET_KEY (pipeline/.env locally, repo
secrets in CI). If either is missing it logs and exits 0, so the refresh
never fails just because history couldn't be saved.
"""
import json
import os
import subprocess
import sys
from pathlib import Path

import requests

PIPELINE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PIPELINE_DIR))
import core.load  # noqa: E402,F401  (loads pipeline/.env)

WEB_DATA_DIR = PIPELINE_DIR.parent / "web" / "public" / "data"

# (area_type, city, scores file, Census file)
SOURCES = [
    ("district", "stpaul", "neighborhoods.json", "affordability_stpaul.json"),
    ("district", "mpls", "neighborhoods_mpls.json", "affordability_mpls.json"),
    ("zip", None, "neighborhoods_zip.json", "affordability_zip.json"),
]


def _load(name):
    path = WEB_DATA_DIR / name
    if not path.exists():
        return None
    with open(path) as f:
        return json.load(f)


def _git_sha():
    sha = os.environ.get("GITHUB_SHA")
    if sha:
        return sha
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=PIPELINE_DIR, text=True).strip()
    except Exception:
        return None


def build_rows():
    """Return (run metadata, snapshot rows) from the exported JSON files."""
    rows, data_generated, acs_year = [], None, None
    for area_type, city, scores_file, census_file in SOURCES:
        scores = _load(scores_file)
        if scores is None:
            print(f"[WARN] {scores_file} missing, skipping")
            continue
        data_generated = data_generated or scores.get("metadata", {}).get("data_generated")
        census_doc = _load(census_file) or {}
        acs_year = acs_year or census_doc.get("acs_year")
        census_by_id = {str(k): v for k, v in (census_doc.get("districts") or {}).items()}

        for n in scores["neighborhoods"]:
            idx = n.get("indices") or {}
            census = census_by_id.get(str(n["district_id"])) or {}
            rows.append({
                "area_type": area_type,
                "area_id": int(n["district_id"]),
                "city": city,
                "area_name": n.get("district_name"),
                "population": n.get("population"),
                "health_score": n.get("health_score"),
                "safety": idx.get("safety"),
                "opportunity": idx.get("opportunity"),
                "amenities": idx.get("amenities"),
                "transportation": idx.get("transportation"),
                "economic_profile": idx.get("affordability"),
                "walkability_score": idx.get("walkability_score"),
                "education_score": idx.get("education_score"),
                "commute_score": idx.get("commute_score"),
                "broadband_score": idx.get("broadband_score"),
                "median_home_value": census.get("median_home_value"),
                "median_gross_rent": census.get("median_gross_rent"),
                "median_household_income": census.get("median_household_income"),
                "poverty_rate": census.get("poverty_rate"),
                "metrics": n.get("metrics"),
                "census": census or None,
            })
    # NaN isn't valid JSON; store as null.
    for r in rows:
        for k, v in r.items():
            if isinstance(v, float) and v != v:
                r[k] = None
    run = {
        "data_generated": data_generated,
        "acs_year": acs_year,
        "git_sha": _git_sha(),
        "trigger": "github-actions" if os.environ.get("GITHUB_ACTIONS") else "local",
        "area_count": len(rows),
    }
    return run, rows


# Health-check thresholds: flag a refresh whose numbers jumped implausibly
# since the previous run — usually a broken/changed source API, not reality.
SCORE_JUMP = 10          # points, on any 0-100 score
METRIC_RATIO = 2.0       # raw_count doubled or halved...
METRIC_MIN_COUNT = 20    # ...when the previous count was at least this big
SCORE_FIELDS = ["health_score", "safety", "opportunity", "amenities",
                "transportation", "economic_profile"]


def _health_check(rows, prev_rows):
    """Compare this refresh against the previous run; return warning strings."""
    if not prev_rows:
        return []
    warnings = []
    prev = {(r["area_type"], r["area_id"]): r for r in prev_rows}
    cur_keys = {(r["area_type"], r["area_id"]) for r in rows}
    for key in prev.keys() - cur_keys:
        warnings.append(f"{key[0]} {key[1]} missing from this refresh")

    # A source that zeroes out (or doubles) for many areas at once points to
    # the source itself, so summarize per metric instead of per area.
    zeroed, jumped = {}, {}
    for r in rows:
        p = prev.get((r["area_type"], r["area_id"]))
        if not p:
            continue
        label = f"{r['area_type']} {r['area_id']} ({r.get('area_name')})"
        for f in SCORE_FIELDS:
            a, b = p.get(f), r.get(f)
            if a is not None and b is not None and abs(float(b) - float(a)) >= SCORE_JUMP:
                warnings.append(f"{label}: {f} {float(a):.0f} -> {float(b):.0f}")
        for m, cur in (r.get("metrics") or {}).items():
            old = ((p.get("metrics") or {}).get(m) or {}).get("raw_count")
            new = (cur or {}).get("raw_count")
            if old is None or new is None or old < METRIC_MIN_COUNT:
                continue
            if new == 0:
                zeroed.setdefault(m, []).append(label)
            elif new / old >= METRIC_RATIO or new / old <= 1 / METRIC_RATIO:
                jumped.setdefault(m, []).append(f"{label} {old}->{new}")
    for m, areas in zeroed.items():
        warnings.append(f"{m} dropped to 0 in {len(areas)} areas (source likely down): {', '.join(areas[:5])}")
    for m, areas in jumped.items():
        warnings.append(f"{m} doubled/halved in {len(areas)} areas: {', '.join(areas[:5])}")
    return warnings


def _previous_rows(rest, headers):
    resp = requests.get(f"{rest}/refresh_runs?select=id&order=id.desc&limit=1",
                        headers=headers, timeout=30)
    resp.raise_for_status()
    if not resp.json():
        return []
    prev_id = resp.json()[0]["id"]
    resp = requests.get(
        f"{rest}/area_snapshots?run_id=eq.{prev_id}&select=area_type,area_id,area_name,metrics,"
        + ",".join(SCORE_FIELDS), headers=headers, timeout=60)
    resp.raise_for_status()
    return resp.json()


def main():
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SECRET_KEY")
    if not url or not key:
        print("[SKIP] SUPABASE_URL / SUPABASE_SECRET_KEY not set; not saving score history")
        return

    run, rows = build_rows()
    if not rows:
        print("[WARN] No score rows found; not saving score history")
        return

    rest = f"{url.rstrip('/')}/rest/v1"
    headers = {"apikey": key, "Content-Type": "application/json",
               "Prefer": "return=representation"}

    warnings = _health_check(rows, _previous_rows(rest, headers))
    run["warnings"] = warnings or None
    for w in warnings:
        # ::warning:: surfaces as an annotation on the GitHub Actions run.
        print(f"::warning::{w}" if os.environ.get("GITHUB_ACTIONS") else f"[WARN] {w}")

    resp = requests.post(f"{rest}/refresh_runs", headers=headers, json=run, timeout=30)
    resp.raise_for_status()
    run_id = resp.json()[0]["id"]

    for r in rows:
        r["run_id"] = run_id
    headers["Prefer"] = "return=minimal"
    resp = requests.post(f"{rest}/area_snapshots", headers=headers, json=rows, timeout=60)
    if not resp.ok:
        # Don't leave an empty run behind.
        requests.delete(f"{rest}/refresh_runs?id=eq.{run_id}", headers=headers, timeout=30)
        resp.raise_for_status()
    print(f"[OK] Saved refresh run {run_id} with {len(rows)} area snapshots to Supabase"
          f" ({len(warnings)} health-check warnings)")


if __name__ == "__main__":
    main()
