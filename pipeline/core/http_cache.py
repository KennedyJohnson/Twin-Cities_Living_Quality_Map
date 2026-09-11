"""
Lightweight on-disk HTTP GET/POST cache for the data pipeline.

A full pipeline refresh touches Overpass, ArcGIS, Census, and CDC endpoints
from several independent scripts (build.py, export_points.py,
export_affordability*.py, export_timeseries.py) that legitimately need the
same underlying data — without a cache, each script re-fetches it from
scratch, multiplying both wall-clock time and rate-limit risk.

This cache uses a short TTL (comfortably longer than one full manual
pipeline run, much shorter than the twice-a-month scheduled refresh) so
reuse *within* a single refresh session is free, while the next real
refresh always starts with a cold/expired cache and fetches live data —
no stale data ever ships. pipeline/.cache/ is gitignored and never
committed.
"""

import sys
from pathlib import Path as _BootstrapPath
sys.path.insert(0, str(_BootstrapPath(__file__).resolve().parent.parent))


import hashlib
import json
import time
from pathlib import Path

import requests

CACHE_DIR = Path(__file__).parent / ".cache"
DEFAULT_TTL_SECONDS = 6 * 60 * 60  # 6 hours: comfortably covers one full pipeline run

# Shared session: reuses TCP/TLS connections across the many sequential and
# parallel requests a full refresh makes to the same handful of hosts
# (ArcGIS, Census, Overpass), instead of paying a fresh handshake each call.
_session = requests.Session()


class _CachedResponse:
    """Minimal requests.Response look-alike for cache hits."""

    def __init__(self, status_code, payload):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload

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


def cached_request(method, url, ttl_seconds=DEFAULT_TTL_SECONDS, **kwargs):
    """Drop-in replacement for requests.get/requests.post that caches the
    parsed JSON response on disk for ttl_seconds.

    Only successful, genuinely-valid JSON responses are cached. Some
    ArcGIS services return rate-limit/errors as HTTP 200 with an
    {"error": ...} body instead of a real error status — those are never
    cached, so a transient 429 can't get "frozen" as if it were real data.
    """
    params = kwargs.get("params")
    data = kwargs.get("data")
    key = _cache_key(method, url, params, data)
    cache_file = CACHE_DIR / f"{key}.json"

    if cache_file.exists():
        age = time.time() - cache_file.stat().st_mtime
        if age < ttl_seconds:
            cached = json.loads(cache_file.read_text())
            return _CachedResponse(cached["status_code"], cached["payload"])

    resp = _session.request(method, url, **kwargs)
    if resp.status_code < 400:
        try:
            payload = resp.json()
        except ValueError:
            return resp
        if isinstance(payload, dict) and "error" in payload:
            return resp  # ArcGIS-style 200-with-error-body — don't cache
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        cache_file.write_text(json.dumps({"status_code": resp.status_code, "payload": payload}))
    return resp


def cached_get(url, ttl_seconds=DEFAULT_TTL_SECONDS, **kwargs):
    return cached_request("GET", url, ttl_seconds=ttl_seconds, **kwargs)


def cached_post(url, ttl_seconds=DEFAULT_TTL_SECONDS, **kwargs):
    return cached_request("POST", url, ttl_seconds=ttl_seconds, **kwargs)
