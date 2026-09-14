"""
Shared Overpass API client with mirror fallback.

The public overpass-api.de instance is frequently overloaded/unreachable
(seen repeatedly as 120s+ connect timeouts during full pipeline runs, once
for every OSM-based source at both district and zip granularity — this can
add tens of minutes to a single build). Every OSM-based cleaner used to
retry that same single endpoint 2-3 times with backoff, which just waits
out the same dead server repeatedly instead of trying an alternative.

This module retries across several independent public Overpass mirrors
instead, so a build only stalls if ALL of them are down at once. Each
mirror is cached under its own URL (core/http_cache.py's cache key includes
the URL), so a later run that reuses the cache is unaffected by which
mirror originally answered.
"""

import time
from core.http_cache import cached_post

# All run the same Overpass QL API. Order is a rough preference (the
# canonical instance first), not a guarantee of uptime — any dead mirror is
# just skipped quickly relative to the old same-server retry loop.
OVERPASS_MIRRORS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.osm.ch/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]

DEFAULT_HEADERS = {
    "User-Agent": "StPaulNeighborhoodHealth/1.0 (data pipeline)",
    "Accept": "*/*",
}


def fetch_overpass(query, timeout=120, ttl_seconds=None, attempts_per_mirror=1, retry_sleep_seconds=5):
    """
    POST an Overpass QL query, trying each mirror in OVERPASS_MIRRORS in
    turn (optionally more than once each) until one succeeds.

    Args:
        query: raw Overpass QL query string
        timeout: per-request timeout in seconds
        ttl_seconds: cache TTL passed to cached_post (None uses its default)
        attempts_per_mirror: retries per mirror before moving to the next
            (kept at 1 by default — moving to a different mirror is a more
            useful use of time than re-hitting one that just failed)
        retry_sleep_seconds: pause between attempts

    Returns:
        The parsed response JSON's "elements" list.

    Raises:
        The last exception seen, if every mirror/attempt fails.
    """
    kwargs = {}
    if ttl_seconds is not None:
        kwargs["ttl_seconds"] = ttl_seconds

    last_error = None
    total_attempts = len(OVERPASS_MIRRORS) * attempts_per_mirror
    attempt = 0
    for mirror in OVERPASS_MIRRORS:
        for _ in range(attempts_per_mirror):
            attempt += 1
            try:
                response = cached_post(
                    mirror, data={"data": query}, headers=DEFAULT_HEADERS, timeout=timeout, **kwargs
                )
                response.raise_for_status()
                return response.json()["elements"]
            except Exception as e:
                last_error = e
                print(f"  [WARNING] Overpass mirror {mirror} failed ({e}); "
                      f"{'trying next mirror' if attempt < total_attempts else 'no mirrors left'}")
                if attempt < total_attempts:
                    time.sleep(retry_sleep_seconds)
    raise last_error
