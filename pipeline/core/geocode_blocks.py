"""
Geocode St. Paul's crime BLOCK strings (e.g. "184X WORDSWORTH AV" or
"CASE AV & EDGERTON") to an approximate point, since the Crime Incident
Report FeatureServer carries no coordinates — only a block-level address
or intersection description. A "184X" block is converted to its midpoint
address (1845) before geocoding, so the resulting point is a block-center
approximation, not the true incident location.

Results are cached indefinitely in pipeline/core/.cache/ (gitignored) keyed
by the raw BLOCK string, since a street block's location never changes —
this avoids re-geocoding the same few thousand unique blocks on every
pipeline run.
"""

import json
import re
import time
from pathlib import Path

from core.http_cache import cached_get

CACHE_FILE = Path(__file__).parent / ".cache" / "stpaul_block_geocode.json"
CENSUS_URL = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress"
NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
NOMINATIM_USER_AGENT = "TwinCitiesLivingQualityMap/1.0 (https://github.com/KennedyJohnson/Twin-Cities_Living_Quality_Map)"

# Every block here is appended ", Saint Paul, MN", but a geocoder can still
# match an ambiguous/misspelled street to a same-named street elsewhere in
# the state (e.g. "PARK ST" resolving near Lino Lakes, ~15 miles north of
# St. Paul) with no error — it just returns a confident, wrong point. Bound
# accepted results to St. Paul's city limits (with a small buffer) and treat
# anything outside as a failed geocode rather than plot it in the wrong city.
ST_PAUL_BBOX = (44.87, -93.20, 45.03, -92.97)  # (south, west, north, east)


def _in_bbox(lat, lon):
    south, west, north, east = ST_PAUL_BBOX
    return south <= lat <= north and west <= lon <= east

_BLOCK_RE = re.compile(r"^\s*(\d+)X\s+(.+?)\s*$", re.IGNORECASE)


def _load_cache():
    if CACHE_FILE.exists():
        try:
            return json.loads(CACHE_FILE.read_text())
        except (json.JSONDecodeError, OSError):
            return {}
    return {}


def _save_cache(cache):
    CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
    CACHE_FILE.write_text(json.dumps(cache))


def _to_address(block):
    """Convert a BLOCK string to a geocodable address, or None if it can't
    be parsed. Returns (address, is_intersection)."""
    block = str(block).strip()
    if not block:
        return None, False

    if "&" in block:
        street1, street2 = block.split("&", 1)
        street1, street2 = street1.strip(), street2.strip()
        if not street1 or not street2:
            return None, False
        return f"{street1} and {street2}, Saint Paul, MN", True

    match = _BLOCK_RE.match(block)
    if match:
        block_num, street = match.groups()
        midpoint = int(block_num) * 10 + 5
        return f"{midpoint} {street}, Saint Paul, MN", False

    # Already looks like a plain address — geocode as-is
    return f"{block}, Saint Paul, MN", False


def _geocode_census(address):
    try:
        resp = cached_get(
            CENSUS_URL,
            ttl_seconds=10 * 365 * 24 * 60 * 60,
            params={"address": address, "benchmark": "Public_AR_Current", "format": "json"},
            timeout=15,
        )
        resp.raise_for_status()
        matches = resp.json().get("result", {}).get("addressMatches", [])
        if matches:
            coords = matches[0]["coordinates"]
            lat, lon = float(coords["y"]), float(coords["x"])
            if _in_bbox(lat, lon):
                return lat, lon
    except Exception:
        pass
    return None


def _geocode_nominatim(address):
    try:
        resp = cached_get(
            NOMINATIM_URL,
            ttl_seconds=10 * 365 * 24 * 60 * 60,
            params={"q": address, "format": "json", "limit": 1},
            headers={"User-Agent": NOMINATIM_USER_AGENT},
            timeout=15,
        )
        resp.raise_for_status()
        results = resp.json()
        if results:
            lat, lon = float(results[0]["lat"]), float(results[0]["lon"])
            if _in_bbox(lat, lon):
                return lat, lon
    except Exception:
        pass
    return None


def geocode_blocks(blocks):
    """blocks: iterable of raw BLOCK strings.

    Returns dict {block: (lat, lon) or None} for every unique, non-null
    input block string.
    """
    unique_blocks = sorted({str(b).strip() for b in blocks if b is not None and str(b).strip()})
    cache = _load_cache()
    result = {}
    dirty = False

    for block in unique_blocks:
        if block in cache:
            result[block] = tuple(cache[block]) if cache[block] is not None else None
            continue

        address, is_intersection = _to_address(block)
        coords = None
        if address:
            # Census geocoder handles plain street addresses well but is
            # unreliable for intersections — try Nominatim first for those.
            if is_intersection:
                coords = _geocode_nominatim(address)
                time.sleep(1)  # Nominatim usage policy: max 1 request/sec
            else:
                coords = _geocode_census(address)
                if coords is None:
                    coords = _geocode_nominatim(address)
                    time.sleep(1)

        cache[block] = list(coords) if coords else None
        result[block] = coords
        dirty = True

    if dirty:
        _save_cache(cache)

    return result
