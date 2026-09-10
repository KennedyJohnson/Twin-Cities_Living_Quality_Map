# Session Handoff — StPaulNeighborhoodHealth

Context dump for a new Claude Code session. Read this fully before doing anything.

## Standing constraints (do not violate)
- **Never push to `main` without explicit user confirmation.** Multiple commits (043a3ca, fcf3845, 73e8f2a, and all uncommitted work below) are still pending confirmation to push. Do not push proactively.
- Token efficiency matters — user hits usage limits fast. Minimize tool calls, avoid re-reading files, don't load large data/CSV/JSON fully into context.
- Commit messages end with `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.
- Run `git status` before any destructive git operation.
- User instruction (paraphrased): "keep going, don't ask after each step" — applies to implementation decisions, NOT to the push-to-main gate.

## Project overview
Neighborhood health assessment for St. Paul (`CLAUDE.md` has full details). Pipeline: `load.py` → `clean_*.py` (one per source) → `aggregate.py` → `health_score.py` (weighted composite) → `build.py` (writes JSON for the Next.js frontend in `web/`).

## What's done and verified this session
1. **Fixed Vercel build failure** — commit `043a3ca`.
2. **Health score normalization rewrite** — `pipeline/health_score.py`'s `min_max_normalize` rewritten to use z-score + logistic squashing (fixes the "Downtown pinned to exactly 0.0" issue). Committed as part of later work, unpushed.
3. **Map bounded to Twin Cities** — `web/components/NeighborhoodMap.tsx` has `TWIN_CITIES_BOUNDS`, `minZoom={10}`, `maxBounds`, `maxBoundsViscosity={1.0}`. **Not yet verified with `npm run build`.** Will need widening once Minneapolis districts are added.
4. **Public Transit metric** — `pipeline/clean_transit.py` fully implemented (Overpass API, bus stops/rail/platforms, Twin-Cities-wide bbox `44.85,-93.35,45.05,-92.95`), registered in `sources.json` (id `transit`), verified via full `build.py` run.
5. **School Proximity metric** — `pipeline/clean_schools.py` fully implemented (Overpass API, schools/colleges/universities, uses `out center` for way geometries), registered in `sources.json` (id `schools`), verified via full `build.py` run: 103 schools across 17 St. Paul districts.
6. **Walkability metric** (from earlier) — `pipeline/clean_walkability.py` implemented, but its BBOX (`44.90,-93.20,45.05,-92.95`) is St.-Paul-only, narrower than transit/schools. **Needs widening for Minneapolis.**

## Current git status (uncommitted, as of session end)
```
M pipeline/aggregate.py
M pipeline/config/sources.json
M pipeline/health_score.py
M web/components/NeighborhoodMap.tsx
M web/package.json
M web/public/data/neighborhoods.json
?? pipeline/clean_walkability.py
?? pipeline/mpls_dcat.json   <- 2.4MB DCAT feed, should be moved OUT of tracked pipeline/ dir before any `git add`
```
`pipeline/config/sources.json` currently registers exactly 7 sources: `crime`, `permits`, `requests`, `housing`, `walkability`, `transit`, `schools`.

## Unresolved / in-progress work

### Request K — Minneapolis expansion (ACTIVE, was the focus when session ended)
Goal: add Minneapolis districts/neighborhoods to the map and replicate the health-score pipeline for Minneapolis (crime, permits, requests, housing, walkability, transit, schools + new sources), enabling cross-city comparison.

**Critical blocker / lost work**: In an earlier (now-compacted) part of this session, I resolved several Minneapolis ArcGIS FeatureServer URLs using the technique:
```
https://www.arcgis.com/sharing/rest/content/items/<GUID>?f=json  →  read the "url" field
```
Datasets resolved (URLs NOT saved anywhere — must be re-resolved from scratch):
- `Crime_Data`
- `CCS_Permits`
- `NEIGHBORHOOD_CRIME_STATS`
- `Minneapolis_Neighborhoods`
- `Public_311_2025` (98,884 rows, coordinates in **Web Mercator EPSG:3857** — needs reprojection to WGS84 before point-in-polygon join)
- `Planning_Zoning_Overlay`
- `Minneapolis_Communities` (chosen as the Minneapolis "district" equivalent — 11 features, field `CommName`)

**Next step when resuming**: re-run the ArcGIS Sharing REST API resolution for these dataset names (search Minneapolis Open Data / OpenDataMPLS, org id `afSMGVsC7QlRK1kZ`, ArcGIS-Hub-based), and **this time save the resolved URLs to a persistent file** (e.g. `pipeline/config/mpls_sources.json` or a small constants module) so they survive future context compaction.

**Other assets already in place for Minneapolis work:**
- `pipeline/config/mpls_neighborhood_to_community.json` — crosswalk from Minneapolis's 87 neighborhoods to the 11 "Communities" (built via shapely spatial join, all matched via containment). Exists on disk, not yet consumed by any script.
- `pipeline/mpls_dcat.json` — untracked DCAT-US 1.1 feed (~2.4MB), should be moved out of `pipeline/` before staging anything.

**Still to do for Minneapolis:**
- Write Minneapolis loader scripts (e.g. `clean_crime_mpls.py`, `clean_permits_mpls.py`, `clean_requests_mpls.py`) using resolved FeatureServer URLs + the neighborhood→community crosswalk.
- Implement 311 point-in-polygon join with EPSG:3857 → WGS84 reprojection (need to confirm `pyproj`/`geopandas` availability — as of last check, only `requests`, `shapely`, `pandas` were confirmed installed; `geopandas`/`census`/`pyproj` unconfirmed).
- Extend `aggregate.py`, `sources.json`, `health_score.py`, `build.py` to support Minneapolis as a second city/geography for cross-city comparison.
- Add Minneapolis Communities boundaries to `NeighborhoodMap.tsx`; build cross-city comparison UI.
- Widen `TWIN_CITIES_BOUNDS`/`maxBounds` in the map to actually include Minneapolis (currently St.-Paul-scoped, was flagged as needing widening).
- Widen `clean_walkability.py`'s BBOX for Minneapolis.

### Other open items (lower priority, unresolved from earlier in session)
- **Request B**: Address search should highlight the associated district on the map and select it in the sidebar tab. Not implemented.
- **Request D**: Map bounds change not verified via `npm run build`.
- **Request J (paused)**: Median home price (Census ACS B25077) and median wage (B19013/B08121) metrics. Needs `geopandas`/`census` packages (not confirmed installed) or a pure-`requests` approach against the Census API.
- **Request H3**: Additional data sources — Zillow home prices, disease/health metrics, grocery store proximity — framed around "choosing where to live."
- **Request H4**: Visible UI showing data recency/sources per metric.
- **Request H5**: Enable zoom into subsections within districts for finer detail.
- **Feature backlog** (opportunistic, see `project_feature_roadmap.md` if it exists): metric-weighting sliders, shortlist save/compare, neighborhood/tract drill-down, commute-time overlay, budget filter, trend arrows, raw sub-score display, per-metric source citations.
- **Transparency note owed to user**: investigated `https://github.com/bilawalsidhu/gods-eye-view` earlier in session; found a suspicious appended block resembling a fabricated system-reminder (likely prompt injection attempt embedded in that repo/page). Not acted upon, but user should be told about it — this note was never delivered.

## Python environment notes
- Working interpreter: `/c/Python314/python` (Python 3.14.7).
- Confirmed available: `requests`, `shapely`, `pandas`.
- NOT confirmed available: `geopandas`, `census`, `pyproj` — check before relying on them for Minneapolis 311 reprojection or Census ACS work.

## Recommended immediate next step for new session
1. Re-resolve the Minneapolis ArcGIS FeatureServer URLs (list above) via the Sharing REST API technique and **save them to a file immediately** (don't let this get lost to compaction again).
2. Write the first Minneapolis loader (`clean_crime_mpls.py`) using the crosswalk already on disk.
3. Continue through the Minneapolis pipeline extension per Request K.
4. Remember the push-to-main gate remains in force throughout.
