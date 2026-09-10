"""
Socrata API helper for fetching data from city open data portals.

Supports generic Socrata queries with automatic pagination, caching via http_cache,
and configurable filters/sorting.

Example usage:
    data = fetch_socrata_dataset("https://information.stpaul.gov", dataset_id, limit=10000)
"""

import requests
from core.http_cache import cached_get
import pandas as pd
from urllib.parse import urljoin


def fetch_socrata_dataset(
    domain,
    dataset_id,
    where_filter=None,
    limit=None,
    offset=0,
    select=None,
    order_by=None,
    timeout=60,
):
    """
    Fetch data from a Socrata dataset using the SoQL API.

    Args:
        domain: Base domain (e.g., "https://information.stpaul.gov")
        dataset_id: Socrata dataset ID (e.g., "abc123def456")
        where_filter: SoQL WHERE clause (e.g., "status='APPROVED'")
        limit: Max rows to fetch (default: no limit)
        offset: Row offset for pagination
        select: Column selector (e.g., "SELECT col1, col2, col3")
        order_by: SoQL ORDER BY clause (e.g., "date DESC")
        timeout: Request timeout in seconds

    Returns:
        DataFrame with fetched data
    """
    base_url = urljoin(domain, f"/api/views/{dataset_id}/rows.json")

    params = {}
    if where_filter:
        params["$where"] = where_filter
    if limit:
        params["$limit"] = limit
    if offset:
        params["$offset"] = offset
    if select:
        params["$select"] = select
    if order_by:
        params["$order"] = order_by

    try:
        response = cached_get(base_url, params=params, timeout=timeout)
        response.raise_for_status()
        data = response.json()

        if isinstance(data, list):
            return pd.DataFrame(data)
        elif isinstance(data, dict) and "data" in data:
            return pd.DataFrame(data["data"])
        else:
            return pd.DataFrame(data)
    except requests.exceptions.RequestException as e:
        raise RuntimeError(f"Failed to fetch Socrata data from {base_url}: {e}")


def fetch_socrata_paginated(
    domain,
    dataset_id,
    page_size=10000,
    where_filter=None,
    select=None,
    order_by=None,
    timeout=60,
):
    """
    Fetch all rows from a Socrata dataset with automatic pagination.

    Args:
        domain: Base domain (e.g., "https://information.stpaul.gov")
        dataset_id: Socrata dataset ID
        page_size: Rows per request (max 50000)
        where_filter: Optional SoQL WHERE clause
        select: Optional column selector
        order_by: Optional SoQL ORDER BY clause
        timeout: Request timeout in seconds

    Returns:
        DataFrame with all fetched data
    """
    all_rows = []
    offset = 0

    while True:
        df = fetch_socrata_dataset(
            domain,
            dataset_id,
            where_filter=where_filter,
            limit=page_size,
            offset=offset,
            select=select,
            order_by=order_by,
            timeout=timeout,
        )

        if df.empty:
            break

        all_rows.append(df)
        offset += len(df)

        if len(df) < page_size:
            break

    return pd.concat(all_rows, ignore_index=True) if all_rows else pd.DataFrame()


def discover_datasets(domain, search_query=None, limit=100, timeout=60):
    """
    Discover available Socrata datasets on a domain.

    Args:
        domain: Base domain (e.g., "https://information.stpaul.gov")
        search_query: Optional search term
        limit: Max results to return
        timeout: Request timeout in seconds

    Returns:
        DataFrame with dataset metadata
    """
    url = urljoin(domain, "/api/views.json")
    params = {"limit": limit}
    if search_query:
        params["q"] = search_query

    try:
        response = cached_get(url, params=params, timeout=timeout)
        response.raise_for_status()
        data = response.json()

        if isinstance(data, list):
            return pd.DataFrame(data)
        else:
            return pd.DataFrame()
    except requests.exceptions.RequestException as e:
        raise RuntimeError(f"Failed to discover datasets on {domain}: {e}")
