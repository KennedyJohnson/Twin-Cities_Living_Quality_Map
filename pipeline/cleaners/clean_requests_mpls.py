"""
Clean Minneapolis 311 Service Requests data (ArcGIS FeatureServer) and assign
districts via spatial join. Coordinates are in EPSG:3857 (Web Mercator) and are
reprojected to WGS84 manually (no pyproj dependency) before the point-in-polygon join.
"""

import sys
from pathlib import Path as _BootstrapPath
sys.path.insert(0, str(_BootstrapPath(__file__).resolve().parent.parent))


import datetime
import json
import math
import pandas as pd
from pathlib import Path
from shapely.geometry import Point, shape
from core.load import resolve_boundaries, _fetch_arcgis_paginated
from core.date_window import filter_recent_years, since_year

PIPELINE_DIR = Path(__file__).resolve().parent.parent
MPLS_SOURCES = json.loads((PIPELINE_DIR / "config" / "mpls_sources.json").read_text())

# Minneapolis's 311 data is split one FeatureServer per year (Public_311_2015
# .. Public_311_2026, per mpls_sources.json's note), unlike St. Paul's single
# all-years endpoint. The configured URL is the 2025 one; substitute the year
# to reach any other.
FEATURE_SERVER = MPLS_SOURCES["requests_311"]["featureServer"]
_FEATURE_SERVER_YEAR_PLACEHOLDER = "2025"

# St. Paul's Resident Service Requests dataset (clean_requests.py) is scoped
# to physical property/neighborhood livability complaints — garbage, tall
# grass, graffiti, snow/ice, abandoned vehicles, potholes, etc. Minneapolis's
# 311 feed is a much broader all-purpose city contact-center system that also
# logs categories St. Paul's dataset has no equivalent for: licensing/permit
# paperwork, utility billing, department callbacks, and police-adjacent
# reports. Left unfiltered, MPLS's request_rate_pc came out ~3x St. Paul's
# not because Minneapolis has more livability issues, but because its 311
# system simply logs more TYPES of citizen contact under one feed — since
# request_rate_pc is inverted (more = worse) in the Amenities score, that
# scope mismatch structurally penalized Minneapolis. This keyword filter
# excludes the administrative/non-livability categories so the remaining
# rate is comparable to St. Paul's scope.
_EXCLUDED_REQUEST_TYPE_KEYWORDS = [
    "callback", "inquiry", "rental license", "licensing", "license",
    "certificate of", "utility billing", "utility connection",
    "utility service", "start utility", "stop utility", "water service turn",
    "development coordinator", "plan review", "assessor",
    "records management", "business license", "fire report records request",
    "fire rig visit request", "fire prevention", "tish", "ppu callback",
    "ccs supervisor", "env mgmt", "city attorney", "election",
    "minimum wage", "change request - mailing", "request meeting with",
    "request application", "homestead", "meter reading", "speed wagon",
    "k9 appearance", "police mounted patrol", "suspicious activity",
    "homeless encampment", "false burglar alarm", "copy of permit",
    "permit fee", "permit issuance", "permit addition refund",
    "permit status", "permit question", "permit problem", "e-bill",
    "duplicate water bill", "sewer callback", "special assessment",
    "pollution control annual registration", "neighborhood parking information",
    "risk mgmt", "elections callback",
]


def _is_livability_request(request_type):
    text = str(request_type).lower()
    return not any(keyword in text for keyword in _EXCLUDED_REQUEST_TYPE_KEYWORDS)


import re

# Minneapolis's 311 taxonomy logs the same underlying complaint TYPE under
# separate categories per intake channel — e.g. "Parking Violation
# Complaint" (call center) vs "Parking Violation - Open311" (app/API), or
# "Graffiti - Open311" vs "Graffiti complaint / reporting". Stripping the
# channel suffix collapses these into one base category so
# same-day/same-location duplicate reports of one real incident (see
# _dedupe_same_day_location below) can be detected across channels instead
# of being hidden by the channel label.
_CHANNEL_SUFFIX_RE = re.compile(
    r"\s*-\s*(open311|self service|ss city|ss)$", re.IGNORECASE
)


def _base_request_category(request_type):
    text = str(request_type).strip()
    text = _CHANNEL_SUFFIX_RE.sub("", text)
    text = re.sub(r"\s*complaint\s*/\s*reporting$", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s+complaint$", "", text, flags=re.IGNORECASE)
    return text.strip().lower()


def _dedupe_same_day_location(svc):
    """Collapse rows that share the same base complaint category, calendar
    day, and rounded coordinate (~1 city block, ~0.001 deg) into one row —
    a proxy for the same real-world issue reported through more than one
    311 channel on the same day. This is a heuristic: it can also merge two
    unrelated but genuinely separate complaints of the same type filed on
    the same block on the same day, but that's a much rarer case than the
    channel-duplication this targets."""
    dates = pd.to_numeric(svc["opened_date"], errors="coerce")
    day = pd.to_datetime(dates, unit="ms", errors="coerce", utc=True).dt.date
    base_category = svc["request_type"].map(_base_request_category)
    lat_round = svc["latitude"].round(3)
    lon_round = svc["longitude"].round(3)
    dedupe_key = list(zip(base_category, day, lat_round, lon_round))
    before = len(svc)
    svc = svc[~pd.Series(dedupe_key, index=svc.index).duplicated()]
    removed = before - len(svc)
    if removed > 0:
        print(f"[INFO] Collapsed {removed} likely same-incident MPLS 311 records "
              f"reported via multiple channels on the same day/location")
    return svc


def _feature_server_for_year(year):
    return FEATURE_SERVER.replace(_FEATURE_SERVER_YEAR_PLACEHOLDER, str(year))


def _web_mercator_to_wgs84(x, y):
    """Convert EPSG:3857 (Web Mercator) coordinates to WGS84 lon/lat.
    XCOORD/YCOORD are plain attribute fields (not the query geometry), so
    _fetch_arcgis_paginated's outSR=4326 request doesn't reproject them —
    this manual conversion is still needed."""
    origin_shift = 20037508.34
    lon = (x / origin_shift) * 180.0
    lat = (y / origin_shift) * 180.0
    lat = 180.0 / math.pi * (2 * math.atan(math.exp(lat * math.pi / 180.0)) - math.pi / 2.0)
    return lon, lat


def _fetch_all_features(out_fields="CASEID,TYPENAME,OPENEDDATETIME,XCOORD,YCOORD,TITLE,REASONNAME,CASESTATUS"):
    # Unlike a single-endpoint source, matching St. Paul's shared
    # recent-years window here means fetching several per-year
    # FeatureServers and concatenating them — previously this only ever
    # queried the 2025 one, so Minneapolis's 311 rate was computed from one
    # year of data while St. Paul's spanned a decade. See clean_crime_mpls.py
    # for why each per-year fetch goes through the shared, non-truncating
    # paginator instead of a hand-rolled loop.
    current_year = datetime.date.today().year
    records = []
    for year in range(since_year(), current_year + 1):
        try:
            df = _fetch_arcgis_paginated(_feature_server_for_year(year), out_fields=out_fields)
        except Exception as e:
            print(f"[WARNING] MPLS 311 fetch failed for {year}: {e}")
            continue
        if df.empty:
            continue
        records.extend(df.drop(columns=["geometry"], errors="ignore").to_dict("records"))
    return records


def clean_requests_mpls(granularity="district"):
    """
    Fetch Minneapolis 311 service request data and assign district_id via
    spatial join against Minneapolis Community boundaries (or zip
    boundaries when granularity="zip").

    Returns:
        DataFrame with columns: district_id, case_id, request_type, opened_date
    """
    boundaries = resolve_boundaries(city="mpls", granularity=granularity)

    features = _fetch_all_features()
    svc = pd.DataFrame(features)

    svc = svc.dropna(subset=["XCOORD", "YCOORD"])

    lonlat = svc.apply(lambda r: _web_mercator_to_wgs84(r["XCOORD"], r["YCOORD"]), axis=1)
    svc["longitude"] = lonlat.map(lambda t: t[0])
    svc["latitude"] = lonlat.map(lambda t: t[1])

    boundary_map = {}
    for feature in boundaries["features"]:
        district_id = feature["properties"]["district_id"]
        boundary_map[district_id] = shape(feature["geometry"])

    def find_district(row):
        try:
            point = Point(row["longitude"], row["latitude"])
            for district_id, polygon in boundary_map.items():
                if polygon.contains(point):
                    return district_id
        except Exception:
            pass
        return None

    svc["district_id"] = svc.apply(find_district, axis=1)

    before_filter = len(svc)
    svc = svc.dropna(subset=["district_id"])
    after_filter = len(svc)
    filtered_count = before_filter - after_filter
    if filtered_count > 0:
        print(f"[WARNING] Filtered {filtered_count} MPLS 311 records with no district match via spatial join")

    svc["district_id"] = svc["district_id"].astype(int)

    svc = svc.rename(columns={
        "CASEID": "case_id",
        "TYPENAME": "request_type",
        "OPENEDDATETIME": "opened_date",
        "TITLE": "title",
        "REASONNAME": "reason",
        "CASESTATUS": "case_status",
    })

    # Restrict to categories comparable to St. Paul's livability/code-
    # enforcement scope — see _EXCLUDED_REQUEST_TYPE_KEYWORDS above.
    before_scope_filter = len(svc)
    svc = svc[svc["request_type"].map(_is_livability_request)]
    excluded_count = before_scope_filter - len(svc)
    if excluded_count > 0:
        print(f"[INFO] Excluded {excluded_count} MPLS 311 records outside St. Paul's request-type scope "
              f"(licensing/permitting/utility-billing/callback/police-adjacent categories)")

    svc = _dedupe_same_day_location(svc)

    # Safety net in case a per-year FeatureServer contains stray out-of-year
    # rows — see core/date_window.py.
    svc = filter_recent_years(svc, "opened_date", epoch_ms=True)

    cols = ["district_id", "case_id", "request_type", "opened_date"]
    for extra in ["title", "reason", "case_status"]:
        if extra in svc.columns:
            cols.append(extra)
    cols += ["longitude", "latitude"]
    return svc[cols]


if __name__ == "__main__":
    cleaned = clean_requests_mpls()
    print(f"[OK] Cleaned MPLS 311 requests data: {len(cleaned)} records")
    print(f"Districts represented: {sorted(cleaned['district_id'].unique())}")
    print(cleaned["district_id"].value_counts())
