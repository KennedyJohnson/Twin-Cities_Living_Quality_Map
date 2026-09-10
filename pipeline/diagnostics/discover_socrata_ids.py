"""
Discover Socrata dataset IDs from city open data portals.

Usage:
    python discover_socrata_ids.py

This script queries the Socrata API discovery endpoints to find dataset IDs
for crime, permits, service requests, and housing production datasets.

Results should be set as environment variables or added to pipeline/.env:
    STPAUL_CRIME_ID=<id>
    STPAUL_PERMITS_ID=<id>
    STPAUL_REQUESTS_ID=<id>
    STPAUL_HOUSING_ID=<id>
"""

import sys
from pathlib import Path as _BootstrapPath

sys.path.insert(0, str(_BootstrapPath(__file__).resolve().parent.parent))

import requests
from tabulate import tabulate


def discover_stpaul_datasets():
    """Discover St. Paul Socrata datasets."""
    print("\n=== Discovering St. Paul Open Data Datasets ===\n")

    domain = "https://information.stpaul.gov"
    search_terms = {
        "crime": ["crime", "incident"],
        "permits": ["permit", "building"],
        "requests": ["311", "service", "request"],
        "housing": ["housing", "production"],
    }

    results = {}

    for dataset_type, terms in search_terms.items():
        for term in terms:
            try:
                url = f"{domain}/api/search/views.json"
                params = {"q": term, "limit": 10}
                response = requests.get(url, params=params, timeout=10)
                response.raise_for_status()
                data = response.json()

                if data:
                    results[dataset_type] = data
                    print(f"✓ Found {len(data)} results for '{dataset_type}' (search: '{term}')")
                    break
            except Exception as e:
                print(f"✗ Error searching for '{dataset_type}' with term '{term}': {e}")
                continue

    if not results:
        print("\n[INFO] Could not query Socrata API. Trying alternative approach...\n")
        return discover_stpaul_datasets_alternative()

    # Display results
    for dataset_type, datasets in results.items():
        print(f"\n--- {dataset_type.upper()} ---")
        table_data = []
        for i, ds in enumerate(datasets[:5], 1):
            table_data.append(
                [i, ds.get("id", "N/A")[:16] + "...", ds.get("name", "N/A")[:40]]
            )
        print(
            tabulate(
                table_data,
                headers=["#", "Dataset ID", "Name"],
                tablefmt="grid",
            )
        )
        if datasets:
            print(f"\nCandidate ID: {datasets[0]['id']}")


def discover_stpaul_datasets_alternative():
    """Fallback discovery method."""
    print("\n=== Manual Dataset Discovery Guide ===\n")
    print("Since API discovery is unavailable, follow these steps:\n")

    steps = [
        "1. Open: https://information.stpaul.gov/browse",
        "2. For each dataset below, search and click to view:",
        "   - 'Crime Incident Report'",
        "   - 'Building Permits' or 'Approved Permits'",
        "   - 'Service Requests' or 'Resident Requests'",
        "   - 'Housing Production'",
        "",
        "3. For each dataset, look for:",
        "   - An 'API' or 'Download' button",
        "   - A URL like: /api/views/{DATASET_ID}/rows.json",
        "   - Extract the {DATASET_ID} portion",
        "",
        "4. Set as environment variables:",
        "   export STPAUL_CRIME_ID='<id>'",
        "   export STPAUL_PERMITS_ID='<id>'",
        "   export STPAUL_REQUESTS_ID='<id>'",
        "   export STPAUL_HOUSING_ID='<id>'",
        "",
        "5. Or add to pipeline/.env (gitignored):",
        "   STPAUL_CRIME_ID=<id>",
        "   STPAUL_PERMITS_ID=<id>",
        "   STPAUL_REQUESTS_ID=<id>",
        "   STPAUL_HOUSING_ID=<id>",
    ]

    for step in steps:
        print(step)

    print("\nFor more help, see: pipeline/config/stpaul_sources.json")


if __name__ == "__main__":
    try:
        discover_stpaul_datasets()
    except Exception as e:
        print(f"Error during discovery: {e}")
        discover_stpaul_datasets_alternative()
