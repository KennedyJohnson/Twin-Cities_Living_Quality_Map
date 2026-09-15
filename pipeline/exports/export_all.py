"""
Run every exports/export_*.py in one process instead of invoking each as
its own `python` subprocess sequentially. During active development this
runs several times per session, so both sources of overhead are worth
cutting:

- Interpreter/import startup (pandas, numpy, shapely, etc.) paid once per
  `python` invocation — six separate invocations means paying it six times.
- Independent exports' network-bound work (Overpass, ArcGIS, Census, CDC)
  was fully serialized even though nothing in one script's fetch depends on
  another's. Running them concurrently overlaps that waiting instead of
  stacking it up.

export_radius_baseline.py reads the points/lines files export_points.py
writes (to discover which sources have raw geometry shipped to the
browser — see its own docstring), so it's the one real ordering dependency:
export_points.py must finish first. Every other export only reads from the
pipeline's cleaners/aggregation, not from another export's output, so they
run in parallel.

export_radius_score_samples.py runs last, on its own: it scores a sample
grid of points via RadiusScoringContext, which itself reads
radius_baseline_{city}.json, points_{city}.json/lines_trails.json, and
tracts_affordability_{city}.json — i.e. the outputs of export_radius_baseline,
export_points, and export_tracts_affordability all have to already be on
disk, so it can't join the parallel group above.

None of this changes what gets fetched or written — pipeline/core/http_cache.py's
existing 6-hour cache is what actually avoids redundant network calls
across exports (and across build.py) that ask for the same data; this just
stops making them wait on each other.

Run: python exports/export_all.py
"""

import sys
from pathlib import Path as _BootstrapPath
sys.path.insert(0, str(_BootstrapPath(__file__).resolve().parent.parent))


import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import exports.export_points as export_points
import exports.export_timeseries as export_timeseries
import exports.export_affordability as export_affordability
import exports.export_affordability_timeseries as export_affordability_timeseries
import exports.export_tracts_affordability as export_tracts_affordability
import exports.export_radius_baseline as export_radius_baseline
import exports.export_radius_score_samples as export_radius_score_samples


def main():
    start = time.time()

    print("=" * 70)
    print("Running export_points.py first (radius baseline reads its output)")
    print("=" * 70)
    export_points.main()
    print()

    independent = {
        "export_timeseries": export_timeseries.main,
        "export_affordability": export_affordability.main,
        "export_affordability_timeseries": export_affordability_timeseries.main,
        "export_tracts_affordability": export_tracts_affordability.main,
        "export_radius_baseline": export_radius_baseline.main,
    }

    print("=" * 70)
    print(f"Running the remaining {len(independent)} exports in parallel...")
    print("=" * 70)
    with ThreadPoolExecutor(max_workers=len(independent)) as executor:
        future_to_name = {executor.submit(fn): name for name, fn in independent.items()}
        for future in as_completed(future_to_name):
            name = future_to_name[future]
            try:
                future.result()
                print(f"[OK] {name} complete")
            except Exception as e:
                print(f"[ERROR] {name} failed: {e}")

    print("=" * 70)
    print("Running export_radius_score_samples.py (needs the exports above)")
    print("=" * 70)
    try:
        export_radius_score_samples.main()
        print("[OK] export_radius_score_samples complete")
    except Exception as e:
        print(f"[ERROR] export_radius_score_samples failed: {e}")

    elapsed = time.time() - start
    print()
    print(f"All exports complete in {elapsed:.1f}s.")


if __name__ == "__main__":
    main()
