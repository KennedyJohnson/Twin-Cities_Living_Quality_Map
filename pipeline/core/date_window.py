"""
Shared "recent years" date filter for count-based sources (crime, permits,
service requests) that are otherwise compared directly between St. Paul and
Minneapolis.

Why this exists: without it, each city's raw record count reflects however
many years of history that particular ArcGIS/Socrata dataset happens to
carry — St. Paul's crime data went back to 2014 while Minneapolis's only
had real coverage from ~2019, and Minneapolis's 311 requests were fetched
from a single-year FeatureServer while St. Paul's spanned 2015-2025. A
longer history window inflates a city's per-capita rate independent of
anything actually happening on the ground, which breaks the pooled
cross-city normalization the health score now relies on. Restricting both
cities to the same trailing window makes the comparison apples-to-apples.
"""

import datetime
import pandas as pd

# Trailing complete years to include, plus whatever's happened so far in
# the current (partial) year — 3 was chosen as long enough to smooth out
# single-year noise while staying within what every source can supply on
# both sides (Minneapolis's 311 data is only available one year per
# FeatureServer, so a very long window means many extra fetches).
RECENT_YEARS = 3


def since_year():
    """First calendar year to include in the shared recent-years window."""
    return datetime.date.today().year - RECENT_YEARS


def filter_recent_years(df, date_col, epoch_ms=True, since=None):
    """
    Keep only rows whose date_col falls within the shared recent-years
    window (see module docstring). Rows with an unparseable date are
    dropped rather than kept, since we can't tell if they're in-window.

    Args:
        df: DataFrame to filter
        date_col: name of the date column
        epoch_ms: True if date_col holds epoch-millisecond integers
            (ArcGIS's usual date encoding), False for string/datetime dates
        since: override the cutoff year (defaults to since_year())
    """
    if date_col not in df.columns or df.empty:
        return df

    cutoff = since if since is not None else since_year()
    if epoch_ms:
        parsed = pd.to_datetime(pd.to_numeric(df[date_col], errors="coerce"), unit="ms", errors="coerce", utc=True)
    else:
        parsed = pd.to_datetime(df[date_col], errors="coerce")

    return df[parsed.dt.year >= cutoff]
