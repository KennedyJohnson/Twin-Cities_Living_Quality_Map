"""
Lightweight on-disk HTTP GET/POST cache for the data pipeline.

A full pipeline refresh touches Overpass, ArcGIS, Census, and CDC endpoints
from several independent scripts (build.py, export_points.py,
export_affordability*.py, export_timeseries.py) that legitimately need the
same underlying data — without a cache, each script re-fetches it from
scratch, multiplying both wall-clock time and rate-limit risk.

pipeline/.cache/ is gitignored and the scheduled GitHub Actions refresh
checks out a fresh repo on every run, so no TTL chosen here can ever cause
CI to ship stale data — CI is always cold regardless. That means the TTL
only actually matters for a developer's own machine across repeated local
runs, so its default (DEFAULT_TTL_SECONDS) just needs to outlast one
real workday of iteration.

For the "I'm testing locally and want to avoid re-fetching anything
already on disk, at all, for as long as possible" case, set
PIPELINE_LOCAL_CACHE=1 in the environment before running build.py /
exports/*.py — every cached_get/cached_post call then uses a 30-day TTL
regardless of what ttl_seconds it individually requested. To force one
call fresh again without clearing the whole cache, delete its specific
file under pipeline/core/.cache/, or clear the directory entirely.
"""

import sys
from pathlib import Path as _BootstrapPath
sys.path.insert(0, str(_BootstrapPath(__file__).resolve().parent.parent))


import hashlib
import json
import os
import time
from pathlib import Path

import requests

CACHE_DIR = Path(__file__).parent / ".cache"
DEFAULT_TTL_SECONDS = 6 * 60 * 60  # 6 hours: comfortably covers one full manual pipeline run
LONG_TTL_SECONDS = 30 * 24 * 60 * 60  # 30 days: used for sources that barely change (OSM/Overpass, Nominatim) and, when PIPELINE_LOCAL_CACHE is set, for every call

_LOCAL_CACHE_MODE = os.environ.get("PIPELINE_LOCAL_CACHE", "").strip().lower() in ("1", "true", "yes")

# Shared session: reuses TCP/TLS connections across the many sequential and
# parallel requests a full refresh makes to the same handful of hosts
# (ArcGIS, Census, Overpass), instead of paying a fresh handshake each call.
_session = requests.Session()


class _CachedResponse:
    """Minimal requests.Response look-alike for cache hits."""

    def __init__(self, status_code, payload=None, text=None):
        self.status_code = status_code
        self._payload = payload
        self.text = text if text is not None else json.dumps(payload)

    def json(self):
        return self._payload if self._payload is not None else json.loads(self.text)

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError(f"HTTP {self.status_code}")


def _cache_key(method, url, params=None, data=None):
    raw = json.dumps(
        {"method": method, "url": url, "params": params, "data": data},
        sort_keys=True,
        default=str,
    )
    return hashlib.sha256(raw.encode()).hexdigest()


def cached_request(method, url, ttl_seconds=DEFAULT_TTL_SECONDS, response_type="json", **kwargs):
    """Drop-in replacement for requests.get/requests.post that caches the
    response on disk for ttl_seconds (bumped to LONG_TTL_SECONDS whenever
    PIPELINE_LOCAL_CACHE is set, no matter what the caller asked for).

    response_type="json" (default) parses+caches the JSON body, the shape
    every ArcGIS/Overpass/Census/CDC endpoint in this pipeline returns.
    response_type="text" instead caches the raw response text verbatim —
    for the handful of sources (e.g. Zillow's CSV downloads) that aren't
    JSON at all.

    Only successful, genuinely-valid responses are cached. Some ArcGIS
    services return rate-limit/errors as HTTP 200 with an {"error": ...}
    JSON body instead of a real error status — those are never cached, so
    a transient 429 can't get "frozen" as if it were real data.
    """
    if _LOCAL_CACHE_MODE:
        ttl_seconds = max(ttl_seconds, LONG_TTL_SECONDS)

    params = kwargs.get("params")
    data = kwargs.get("data")
    key = _cache_key(method, url, params, data) + f":{response_type}"
    cache_file = CACHE_DIR / f"{key}.json"

    if cache_file.exists():
        age = time.time() - cache_file.stat().st_mtime
        if age < ttl_seconds:
            cached = json.loads(cache_file.read_text())
            if response_type == "text":
                return _CachedResponse(cached["status_code"], text=cached["text"])
            return _CachedResponse(cached["status_code"], payload=cached["payload"])

    resp = _session.request(method, url, **kwargs)
    if resp.status_code < 400:
        if response_type == "text":
            CACHE_DIR.mkdir(parents=True, exist_ok=True)
            cache_file.write_text(json.dumps({"status_code": resp.status_code, "text": resp.text}))
        else:
            try:
                payload = resp.json()
            except ValueError:
                return resp
            if isinstance(payload, dict) and "error" in payload:
                return resp  # ArcGIS-style 200-with-error-body — don't cache
            CACHE_DIR.mkdir(parents=True, exist_ok=True)
            cache_file.write_text(json.dumps({"status_code": resp.status_code, "payload": payload}))
    return resp


def cached_get(url, ttl_seconds=DEFAULT_TTL_SECONDS, response_type="json", **kwargs):
    return cached_request("GET", url, ttl_seconds=ttl_seconds, response_type=response_type, **kwargs)


def cached_post(url, ttl_seconds=DEFAULT_TTL_SECONDS, response_type="json", **kwargs):
    return cached_request("POST", url, ttl_seconds=ttl_seconds, response_type=response_type, **kwargs)
