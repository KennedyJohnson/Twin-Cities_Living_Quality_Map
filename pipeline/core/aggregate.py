"""
Aggregate cleaned data by district.
Computes per-district counts and per-capita rates for each registered data source.
Config-driven via sources.json for extensibility.
"""

import sys
from pathlib import Path as _BootstrapPath
sys.path.insert(0, str(_BootstrapPath(__file__).resolve().parent.parent))


import json
import inspect
import pandas as pd
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
from core.load import load_population, load_zip_population

PIPELINE_DIR = Path(__file__).resolve().parent.parent

def load_config(city="stpaul"):
    """Load sources config. city: 'stpaul' or 'mpls'."""
    filename = "sources_mpls.json" if city == "mpls" else "sources.json"
    config_file = PIPELINE_DIR / "config" / filename
    with open(config_file) as f:
        return json.load(f)

# Sources where a district missing from the cleaned data genuinely means
# "we have no data for this district" (e.g. Zillow's ZIP-code coverage
# doesn't reach every district) rather than "this district has zero of the
# thing" — these keep the old drop-and-rescale-weight behavior instead of
# zero-fill. Every other count/sum-based source (crime, permits, requests,
# housing, schools, groceries, restaurants, healthcare, transit, trails,
# crashes, disaster risk, chronic disease, traffic) DOES successfully join
# every district's geometry, so an absent district there means a real zero
# (e.g. zero grocery stores) — treating that as "excused from scoring"
# instead of "scored as zero" silently rewards zero over a low-but-nonzero
# count, and lets districts within the same city be scored on different
# metric sets. See Severity 5 in the pipeline fairness audit.
NO_ZERO_FILL_SOURCES = {"housing_market"}


def aggregate_by_source(source_id, cleaned_data, population_df):
    """
    Aggregate a single data source by district.

    Args:
        source_id: source ID (e.g., "crime", "permits")
        cleaned_data: DataFrame with district_id column
        population_df: DataFrame with district_id and population columns

    Returns:
        dict: {district_id: {metric_name: rate_per_1000, raw_count: count}}
    """
    # Group by district_id: sum a "value" column if present (e.g. trail km),
    # otherwise fall back to counting rows (point-record sources)
    if "value" in cleaned_data.columns:
        grouped = cleaned_data.groupby("district_id")["value"].sum().reset_index(name="raw_count")
    else:
        grouped = cleaned_data.groupby("district_id").size().reset_index(name="raw_count")

    if source_id in NO_ZERO_FILL_SOURCES:
        # Inner join against population — NOT left. A source like Zillow's
        # housing_market can carry raw ZIP codes that aren't in our scored
        # zip set (e.g. one that failed the district-coverage filter in
        # load_zip_boundaries, or a zero-population zip already dropped from
        # population_df); a left join here would keep that row with
        # population=NaN, producing rate_per_1000=NaN. A single NaN in the
        # rates list poisons min_max_normalize's mean/std for EVERY district/
        # zip sharing that metric, not just the offending one — silently
        # zeroing out an entire component (e.g. Opportunity) and the overall
        # health_score for the whole pool. Inner join drops any row whose
        # district/zip isn't a real, scored one, same as the fillna(0) branch
        # below does for its own set of valid ids.
        merged = grouped.merge(population_df[["district_id", "population"]], on="district_id", how="inner")
    else:
        # Reindex against every district in the city, filling absent
        # districts with a real zero rather than dropping them.
        merged = population_df[["district_id", "population"]].merge(grouped, on="district_id", how="left")
        merged["raw_count"] = merged["raw_count"].fillna(0)

    # Compute per-capita rate (per 1000)
    merged["rate_per_1000"] = (merged["raw_count"] / merged["population"]) * 1000

    # Convert to dict: {district_id: {metric_name: rate, raw_count: count}}
    result = {}
    for _, row in merged.iterrows():
        result[int(row["district_id"])] = {
            "raw_count": int(row["raw_count"]),
            "rate_per_1000": round(row["rate_per_1000"], 2)
        }

    return result

def _load_source(source, city, granularity="district"):
    """Import a source's loader module and fetch+clean its data. Runs in a worker thread."""
    source_id = source["id"]
    loader_module_name = source["loader_module"]

    loader_module = __import__(f"cleaners.{loader_module_name}", fromlist=[loader_module_name])
    # The loader module should have a function named clean_<source_id>
    # Use the loader_module_name as the function name (e.g., "clean_crime" -> clean_crime())
    loader_func_name = loader_module_name
    if not hasattr(loader_module, loader_func_name):
        raise AttributeError(f"No function {loader_func_name} in {loader_module_name}")

    loader_func = getattr(loader_module, loader_func_name)
    params = inspect.signature(loader_func).parameters
    kwargs = {}
    # City-agnostic loaders (OSM-based: walkability, transit, schools,
    # groceries) accept a `city` kwarg; city-specific loader modules
    # (e.g. clean_crime_mpls) don't, so only pass it when supported.
    if "city" in params:
        kwargs["city"] = city
    # `granularity` ("district" or "zip") is supported by every cleaner
    # that does its own spatial join; a handful of the oldest ones may not
    # yet, so only pass it when supported (mirrors the `city` check above).
    if "granularity" in params:
        kwargs["granularity"] = granularity
    return loader_func(**kwargs)


def aggregate_all(city="stpaul"):
    """
    Aggregate all registered data sources and return per-district metrics.
    city: 'stpaul' or 'mpls'.

    Sources are fetched/cleaned concurrently (each is a network-bound API
    call), since they're independent of each other and dominate wall-clock
    time; aggregation itself stays sequential since it's cheap in-memory work.

    Returns:
        dict: {source_id: {district_id: {metric_name: rate, raw_count: count}}}
    """
    config = load_config(city=city)
    population = load_population(city=city)

    sources = config["sources"]
    results = {}

    with ThreadPoolExecutor(max_workers=min(8, len(sources)) or 1) as executor:
        future_to_source = {
            executor.submit(_load_source, source, city): source
            for source in sources
        }

        for future in as_completed(future_to_source):
            source = future_to_source[future]
            source_id = source["id"]
            metric_name = source["metric_name"]

            try:
                cleaned_data = future.result()
                metrics = aggregate_by_source(source_id, cleaned_data, population)
                results[source_id] = {
                    "metric_name": metric_name,
                    "metrics": metrics
                }
                print(f"Aggregating {source_id}... [OK] {len(metrics)} districts")
            except Exception as e:
                print(f"Aggregating {source_id}... [ERROR] {e}")

    # Preserve config's source order in the returned dict (order-independent
    # for downstream consumers, but keeps output/log diffs stable).
    ordered = {s["id"]: results[s["id"]] for s in sources if s["id"] in results}
    return ordered


def aggregate_all_combined():
    """
    Aggregate both cities and merge into one per-source dict spanning all 28
    districts, so scoring can normalize St. Paul and Minneapolis together
    instead of each city only against itself (see Severity 1 in the
    pipeline fairness audit — two independently-normalized 0-100 scales
    aren't actually comparable even though the frontend displays and ranks
    them as if they were).

    St. Paul district_ids (1-17) and Minneapolis's (101-111) never collide,
    so merging is a plain dict union per source_id. Both cities' source
    configs define the same 16 source ids with matching health_component/
    rate_direction/weight_in_component (verified) — they only differ in
    metric_name/label text and loader_module, which don't affect scoring.

    Returns:
        dict: {source_id: {district_id: {rate_per_1000, raw_count}}} for
        all 28 districts, plus each source's "metric_name" (from whichever
        city defined it, since only cosmetic wording ever differs).
    """
    stpaul = aggregate_all(city="stpaul")
    mpls = aggregate_all(city="mpls")

    combined = {}
    for source_id in set(stpaul) | set(mpls):
        sp_entry = stpaul.get(source_id)
        mp_entry = mpls.get(source_id)
        metric_name = (sp_entry or mp_entry)["metric_name"]
        metrics = {}
        if sp_entry:
            metrics.update(sp_entry["metrics"])
        if mp_entry:
            metrics.update(mp_entry["metrics"])
        combined[source_id] = {"metric_name": metric_name, "metrics": metrics}
    return combined


def aggregate_all_zip():
    """
    Aggregate all registered data sources by ZIP code, pooling both cities
    into ONE set of zips (not split per city) so every zip in the metro is
    compared directly against every other zip — see
    core/health_score.py's compute_health_scores_zip.

    Each source is loaded once per city (the underlying raw data is
    fetched per city, e.g. St. Paul's crime feed vs Minneapolis's), each
    joined to the SAME shared zip boundary set, then concatenated before
    counting — a boundary zip that catches records from both cities' feeds
    gets both cities' counts correctly summed, rather than one city's
    result silently overwriting the other's contribution to that zip (the
    dict-union approach aggregate_all_combined() uses for districts would
    be wrong here, since zip ids CAN collide across cities at the border).

    Returns:
        dict: {source_id: {metric_name: ..., metrics: {zip_id: {...}}}}
    """
    config_stpaul = load_config(city="stpaul")["sources"]
    config_mpls = {s["id"]: s for s in load_config(city="mpls")["sources"]}
    population = load_zip_population()

    frames_by_source = {}
    with ThreadPoolExecutor(max_workers=8) as executor:
        future_to_info = {}
        for source in config_stpaul:
            future_to_info[executor.submit(_load_source, source, "stpaul", "zip")] = source
            mpls_source = config_mpls.get(source["id"])
            if mpls_source:
                future_to_info[executor.submit(_load_source, mpls_source, "mpls", "zip")] = source

        for future in as_completed(future_to_info):
            source = future_to_info[future]
            source_id = source["id"]
            try:
                df = future.result()
                frames_by_source.setdefault(source_id, []).append(df)
            except Exception as e:
                print(f"Aggregating {source_id} (zip)... [ERROR] {e}")

    results = {}
    for source in config_stpaul:
        source_id = source["id"]
        frames = [f for f in frames_by_source.get(source_id, []) if f is not None and not f.empty]
        if not frames:
            continue
        combined_df = pd.concat(frames, ignore_index=True)
        metrics = aggregate_by_source(source_id, combined_df, population)
        results[source_id] = {"metric_name": source["metric_name"], "metrics": metrics}
        print(f"Aggregating {source_id} (zip)... [OK] {len(metrics)} zips")

    ordered = {s["id"]: results[s["id"]] for s in config_stpaul if s["id"] in results}
    return ordered


if __name__ == "__main__":
    print("Aggregating all data sources by district...")
    print()

    aggregated = aggregate_all()

    print()
    print("=" * 70)
    print("AGGREGATION SUMMARY")
    print("=" * 70)

    for source_id, data in aggregated.items():
        metric_name = data["metric_name"]
        metrics = data["metrics"]
        print(f"\n{source_id} ({metric_name}):")
        for district_id in sorted(metrics.keys()):
            m = metrics[district_id]
            print(f"  District {district_id}: count={m['raw_count']}, rate={m['rate_per_1000']} per 1000")
