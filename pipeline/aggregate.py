"""
Aggregate cleaned data by district.
Computes per-district counts and per-capita rates for each registered data source.
Config-driven via sources.json for extensibility.
"""

import json
import pandas as pd
from pathlib import Path
from load import load_population

PIPELINE_DIR = Path(__file__).parent

def load_config(city="stpaul"):
    """Load sources config. city: 'stpaul' or 'mpls'."""
    filename = "sources_mpls.json" if city == "mpls" else "sources.json"
    config_file = PIPELINE_DIR / "config" / filename
    with open(config_file) as f:
        return json.load(f)

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

    # Merge with population
    merged = grouped.merge(population_df[["district_id", "population"]], on="district_id", how="left")

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

def aggregate_all(city="stpaul"):
    """
    Aggregate all registered data sources and return per-district metrics.
    city: 'stpaul' or 'mpls'.

    Returns:
        dict: {source_id: {district_id: {metric_name: rate, raw_count: count}}}
    """
    config = load_config(city=city)
    population = load_population(city=city)

    results = {}

    for source in config["sources"]:
        source_id = source["id"]
        loader_module_name = source["loader_module"]
        metric_name = source["metric_name"]

        print(f"Aggregating {source_id}...", end=" ")

        try:
            # Dynamically import the loader module
            loader_module = __import__(loader_module_name)
            # The loader module should have a function named clean_<source_id>
            # Use the loader_module_name as the function name (e.g., "clean_crime" -> clean_crime())
            loader_func_name = loader_module_name
            if not hasattr(loader_module, loader_func_name):
                print(f"[ERROR] No function {loader_func_name} in {loader_module_name}")
                continue

            loader_func = getattr(loader_module, loader_func_name)
            cleaned_data = loader_func()

            # Aggregate by district
            metrics = aggregate_by_source(source_id, cleaned_data, population)

            results[source_id] = {
                "metric_name": metric_name,
                "metrics": metrics
            }

            print(f"[OK] {len(metrics)} districts")

        except Exception as e:
            print(f"[ERROR] {e}")

    return results

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
