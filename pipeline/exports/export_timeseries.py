"""
Export yearly counts of crime, permits, service requests, and housing
production — both citywide and per-district — for time-series charts on the
frontend (web/public/data/timeseries_<city>.json).

Trend data is limited to sources that carry a real historical date field
(crime, permits, requests, housing). The OSM-snapshot sources (trails,
transit, schools, groceries) and Census ACS affordability figures are
point-in-time only, so there's no meaningful trend to show for those.

Run: python export_timeseries.py
"""

import sys
from pathlib import Path as _BootstrapPath
sys.path.insert(0, str(_BootstrapPath(__file__).resolve().parent.parent))


import json
from pathlib import Path

import pandas as pd

from cleaners.clean_crime import clean_crime
from cleaners.clean_permits import clean_permits
from cleaners.clean_requests import clean_requests
from cleaners.clean_housing import clean_housing
from cleaners.clean_crime_mpls import clean_crime_mpls
from cleaners.clean_permits_mpls import clean_permits_mpls
from cleaners.clean_requests_mpls import clean_requests_mpls
from cleaners.clean_housing_mpls import clean_housing_mpls

PIPELINE_DIR = Path(__file__).resolve().parent.parent
OUT_DIR = PIPELINE_DIR.parent / "web" / "public" / "data"

# Keep only plausible years — raw source data occasionally has stray
# far-past/far-future dates from data entry errors.
MIN_YEAR = 2005
MAX_YEAR = 2026


def _years_from_string_dates(series):
    dates = pd.to_datetime(series, errors="coerce")
    return dates.dt.year


def _years_from_epoch_ms(series):
    numeric = pd.to_numeric(series, errors="coerce")
    dates = pd.to_datetime(numeric, unit="ms", errors="coerce", utc=True)
    return dates.dt.year


def _district_year_counts(df, year_col):
    """Returns {district_id: {year: count}} for a df with 'district_id' and
    a precomputed 'year' column."""
    valid = df.dropna(subset=["district_id", "year"])
    valid = valid[(valid["year"] >= MIN_YEAR) & (valid["year"] <= MAX_YEAR)]
    grouped = valid.groupby(["district_id", "year"]).size()
    result = {}
    for (district_id, year), count in grouped.items():
        district_id = int(district_id)
        result.setdefault(district_id, {})[int(year)] = int(count)
    return result


def _build_city_timeseries(sources):
    """sources: {source_key: (df, year_col)}. Returns the combined export
    structure for one city: citywide + per-district counts, aligned on the
    union of years across all sources."""
    per_source_district_counts = {}
    all_years = set()

    for source_key, (df, year_col) in sources.items():
        df = df.copy()
        district_counts = _district_year_counts(df, year_col)
        per_source_district_counts[source_key] = district_counts
        for counts_by_year in district_counts.values():
            all_years.update(counts_by_year.keys())

    years = sorted(all_years)

    citywide = {"years": years}
    for source_key, district_counts in per_source_district_counts.items():
        totals_by_year = {}
        for counts_by_year in district_counts.values():
            for year, count in counts_by_year.items():
                totals_by_year[year] = totals_by_year.get(year, 0) + count
        citywide[source_key] = [totals_by_year.get(y, 0) for y in years]

    districts = {}
    all_district_ids = set()
    for district_counts in per_source_district_counts.values():
        all_district_ids.update(district_counts.keys())

    for district_id in all_district_ids:
        entry = {"years": years}
        for source_key, district_counts in per_source_district_counts.items():
            counts_by_year = district_counts.get(district_id, {})
            entry[source_key] = [counts_by_year.get(y, 0) for y in years]
        districts[str(district_id)] = entry

    return {"citywide": citywide, "districts": districts}


def export_stpaul_timeseries():
    # St. Paul's ArcGIS date fields now come back as epoch milliseconds
    # (same format Minneapolis always used), not the string dates they used
    # to be — so these all use the epoch-ms parser now, like MPLS below.
    crime = clean_crime()
    crime["year"] = _years_from_epoch_ms(crime["DATE"])

    permits = clean_permits()
    permits["year"] = _years_from_epoch_ms(permits["ISSUEDATE"])

    requests = clean_requests()
    requests["year"] = _years_from_epoch_ms(requests["REQUEST_DATE"])

    housing = clean_housing()
    housing["year"] = _years_from_epoch_ms(housing["ProjectPermitIssueDate"])

    return _build_city_timeseries({
        "crime": (crime, "year"),
        "permits": (permits, "year"),
        "requests": (requests, "year"),
        "housing": (housing, "year"),
    })


def export_mpls_timeseries():
    crime = clean_crime_mpls()
    crime["year"] = _years_from_epoch_ms(crime["occurred_date"])

    permits = clean_permits_mpls()
    permits["year"] = _years_from_epoch_ms(permits["issue_date"])

    requests = clean_requests_mpls()
    requests["year"] = _years_from_epoch_ms(requests["opened_date"])

    housing = clean_housing_mpls()
    housing["year"] = _years_from_epoch_ms(housing["issue_date"])

    return _build_city_timeseries({
        "crime": (crime, "year"),
        "permits": (permits, "year"),
        "requests": (requests, "year"),
        "housing": (housing, "year"),
    })


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    print("Exporting St. Paul time-series...")
    stpaul = export_stpaul_timeseries()
    (OUT_DIR / "timeseries_stpaul.json").write_text(json.dumps(stpaul))
    print(f"[OK] {len(stpaul['citywide']['years'])} years, {len(stpaul['districts'])} districts")

    print("Exporting Minneapolis time-series...")
    mpls = export_mpls_timeseries()
    (OUT_DIR / "timeseries_mpls.json").write_text(json.dumps(mpls))
    print(f"[OK] {len(mpls['citywide']['years'])} years, {len(mpls['districts'])} districts")


if __name__ == "__main__":
    main()
