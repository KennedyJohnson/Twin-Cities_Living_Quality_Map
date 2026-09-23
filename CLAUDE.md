# Github Directory Overview

## Projects

### 1. Twin Cities Living Quality Map
**Goal:** Create a comprehensive, comparable living-quality assessment across St. Paul (17 District Councils) and Minneapolis (11 Communities)

#### Datasets (100% API-Based Automation)
All data is fetched automatically from official APIs with no manual downloads:
- **City Data** (ArcGIS FeatureServers): Crime, Building Permits (Service Requests and Housing Production are still fetched/cleaned but no longer feed the score — see note below)
- **Census Data** (Census Bureau API): Population, unemployment, median home value/rent/income, poverty rate, housing cost burden, homeownership rate, Gini, vacancy rate, bachelor's+ rate, broadband, commute
- **Geographic** (ArcGIS FeatureServers): District boundaries, neighborhood→district crosswalks (generated dynamically)
- **Mapping** (OpenStreetMap, queried locally via `pyosmium` against a monthly-refreshed Geofabrik Minnesota `.pbf` extract — see `pipeline/core/osm_extract.py` — instead of the public Overpass API): Trails, transit stops, schools, grocery stores, restaurants/bars, healthcare facilities, entertainment venues, apartment buildings, street network (Walk/Bike Score), named-place search index
- **Traffic** (MnDOT ArcGIS): Annual Average Daily Traffic (AADT), pedestrian/cyclist crash locations
- **Health** (CDC Socrata): Obesity/diabetes prevalence by census tract
- **Other**: FEMA natural hazard risk, Zillow for-sale inventory

**Setup:** Only requires `CENSUS_API_KEY` environment variable (free from census.gov). See `pipeline/.env.example` and README.md.

#### Key Metrics Being Developed
- **Living Quality Score** - Composite metric (0-100) combining five equally-weighted (20% each) components:
  - Safety: crime rate, pedestrian/cyclist crash rate, natural hazard risk, chronic disease burden (all inverted)
  - Opportunity: permit rate, unemployment rate (inverted), Zillow housing-market tightness (fewer listings = higher), blended 85/15 with Census bachelor's+ rate
  - Amenities & Services: schools, groceries, restaurants, healthcare access, entertainment venues (movie theaters, performing-arts venues, museums/galleries, nightlife, bowling/arcades — OpenStreetMap), blended 85/15 with a Census broadband/internet-access rate
  - Transportation: trail/transit rate minus traffic volume, blended 60/25/15 with a Zillow-style Walk/Bike Score and a Census commute score (commute time + transit/walk/bike share)
  - Economic Profile (formerly labeled "Affordability" — renamed 2026-09-14 since it blends housing cost, lower=better, with income/homeownership, higher=better, so a high-income area with expensive housing like Summit Hill can still score well here, which "affordability" alone would misleadingly suggest): home value, rent, poverty rate, housing cost burden (inverted), plus household income and homeownership rate, income inequality (Gini, inverted), and vacancy rate (inverted; added 2026-09-21). The weights.json/pipeline key is still `affordability`.
- Each metric is z-score-normalized (then logistic-squashed to 0-100) INDEPENDENTLY before being weight-blended into its component — not pooled with other metrics first. Normalization is pooled across ALL 28 districts of BOTH cities together, not per-city, so St. Paul and Minneapolis scores are directly comparable (see `pipeline/core/health_score.py`'s `compute_health_scores_combined`).
- Crime/permits counts are restricted to a shared trailing recent-years window (`pipeline/core/date_window.py`) so the two cities' differing data-history lengths don't skew the comparison.
- Multi-year trend charts for crime/permits and Census affordability figures
- **Housing Production and Service Requests were removed from the score** (2026-09-13): auditing found both metrics weren't comparable across the two cities' source datasets. Housing Production — Minneapolis has no dedicated new-construction dataset, so it was proxied from all residential building permits (`clean_housing_mpls.py`), most of which are remodels/repairs with zero new dwelling units, undercounting Minneapolis ~5x vs. St. Paul's purpose-built dataset. Service Requests — St. Paul's dataset (`clean_requests.py`) is scoped narrowly to livability/code-enforcement complaints, while Minneapolis's 311 feed (`clean_requests_mpls.py`) is a much broader all-purpose contact-center system covering categories St. Paul doesn't track (licensing, utility billing, animal complaints) and often logs the same complaint under separate categories per intake channel; even after filtering non-comparable categories and deduping likely same-incident channel duplicates, Minneapolis's per-capita rate stayed ~3x St. Paul's. Both cleaners/exports are left in place (unused) in case comparable Minneapolis data sources appear later — see `pipeline/config/weights.json`'s amenities description for the full writeup.
- Geographic disparities between districts and between the two cities

#### Project Structure
```
pipeline/                    # Data processing (build.py orchestrates cleaners/ -> core/ -> exports/)
│   ├── core/load.py         # API loaders for all data sources (100% automated)
│   ├── core/socrata.py      # Socrata API client
│   ├── .env.example         # Template (Census API key only)
│   └── config/              # Configuration, ArcGIS endpoints, crosswalks
web/                         # Next.js frontend (deployed on Vercel)
.github/workflows/           # Scheduled data refresh + CI
```
See `README.md` and `SETUP_API.md` for full architecture and local setup.

#### Local Development Setup
```bash
# Get Census API key: https://api.census.gov/data/key_signup.html
cp pipeline/.env.example pipeline/.env
# Edit pipeline/.env: add CENSUS_API_KEY=your_key_here

cd pipeline
python build.py  # Fetches all data from APIs automatically

# Iterating locally and re-running build.py repeatedly? Set this first so
# every source (Overpass, ArcGIS, Census, CDC, Zillow, ...) is cached to
# disk for 30 days instead of re-fetched — see pipeline/core/http_cache.py.
# Only affects local runs; the scheduled GitHub Actions refresh always
# starts cold regardless (pipeline/.cache/ is gitignored, fresh checkout
# each run), so this can never cause CI to ship stale data.
export PIPELINE_LOCAL_CACHE=1
python build.py
```

#### Automated Refreshes
- **Local:** Run `python build.py` anytime
- **GitHub Actions:** Auto-runs monthly, 8am UTC on the 1st (`.github/workflows/refresh-data.yml`'s `cron: '0 8 1 * *'`, matching the 30-day OSM extract refresh; requires `CENSUS_API_KEY` secret)

#### Geographic Identifiers
- **St. Paul:** District Council (1-17)
- **Minneapolis:** Community (101-111), joined via a neighborhood→community crosswalk
- District_id ranges (1-17 vs 101-111) distinguish the two cities in shared frontend/pipeline code

#### Key Implementation Notes
- **1-mile radius scoring:** Clicking anywhere on the map or searching an address computes a Living Quality Score for that point's 1-mile radius (not just the enclosing district), estimated from OpenStreetMap + Census data using per-area rates against a precomputed baseline (`web/public/data/radius_baseline_{city}.json`, `web/lib/radiusScore.ts`, wired up in `web/components/NeighborhoodMap.tsx`). It excludes metrics only available at the district level (weight redistributed) and Walk/Bike Score's distance decay.
- **District vs. city-average comparison:** The sidebar (`web/components/IndexComparisonChart.tsx`) shows a bar chart comparing the selected district/radius against its own city's average on each component.
- **100% API-Based:** All data loaded from official APIs (ArcGIS FeatureServers, Census Bureau, OpenStreetMap, CDC, MnDOT)
- **No Local Data Files:** Population, boundaries, and crosswalks generated/fetched dynamically from APIs
- **Automatic Pagination:** Large datasets paginated (10K rows per request) with built-in HTTP caching
- **Graceful Degradation:** If an API is down, pipeline logs warning and continues with other datasets
- **Dynamic Crosswalks:** Neighborhood→District mappings generated via spatial joins from crime data coordinates

#### Data Science Extensions — Implemented
- **Home value prediction — 8-model bake-off** (2026-09-22, expanded from an initial Lasso-vs-GBM version same day): `pipeline/analysis/home_value_prediction/` — a standalone model-comparison analysis, not part of `build.py`/the scheduled refresh. `fetch_panel.py` reuses `cleaners/clean_housing_price.py` across 2017-2024 (8 years) to build a 224-row district-year panel (`data/panel.csv`, committed). `train.py` (no API key needed — reads the committed panel) predicts next-year median home value from this year's features, selects features via leave-one-year-out (LOYO) CV forward selection, then evaluates 8 model families (Lasso, Ridge, Bayesian Ridge, Gradient Boosting, Random Forest, KNN, SVR, Gaussian Process) via a full LOYO bake-off — each model trained on 6 years and tested on the 7th, once per year, ranked by mean RMSE across all 7 folds rather than a single held-out year — writes `results.json`, copied to `web/public/data/home_value_prediction.json`. Write-up page at `web/app/home-value-model/page.tsx` (linked from the main map's nav and from `/about`). Key findings (full writeup in the module's `README.md`): (1) the single biggest lever by far was adding this year's own home value as a feature — an initial version omitted it, forcing every model to reconstruct price level from unrelated demographic proxies; adding it dropped Lasso's RMSE from $34,779 to ~$10,400 (R^2 0.89 -> 0.99), and also flipped an earlier finding that more years hurt into more years steadily helping. (2) The top 3 models by LOYO mean RMSE are Lasso, Bayesian Ridge, and Gaussian Process Regression (Elastic Net was dropped — CV picked l1_ratio=1, identical to Lasso) — all regularization/small-sample-suited approaches — beating Gradient Boosting, Random Forest, SVR, and KNN, which build predictions from local splits/neighborhoods that need more repeated examples than ~170-190 rows provides to pay off; this is specific to this dataset's size, not a general linear-beats-boosting claim. `pipeline/tests/test_home_value_prediction.py` runs against the committed panel in CI (no network/API key needed).

#### Data Source Ideas — Evaluated & Deferred
- **St. Paul Vacant Buildings dataset** (information.stpaul.gov): Could be a blight/safety signal, but Minneapolis' open data portal has no equivalent vacant-buildings dataset. Since normalization is pooled across all 28 districts of both cities (see Living Quality Score section above), a metric only one city has would break comparability (zero-filling Minneapolis biases it; excluding Minneapolis from that sub-metric's normalization breaks the shared scale). Deferred unless a parallel Minneapolis source is found.
- Checked information.stpaul.gov, opendata.minneapolismn.gov, and metrogis.org (2026-09-12) — no other datasets found that aren't already covered or redundant with existing ArcGIS FeatureServer / Census / OSM / CDC / MnDOT sources.
- **"Find Your Match" apartments-vs-houses filter** (2026-09-13, deferred — scoped 2026-09-14): `pipeline/cleaners/clean_apartment_buildings.py` only queries Overpass for `building=apartments`, so `web/public/data/apartment_buildings_{city}.json` has no non-apartment residential buildings to filter to. Adding a real "Apartments / Houses" toggle needs a second Overpass query for other residential OSM tags (`building=house`, `detached`, `semidetached_house`, `terrace`, `residential`, etc.) and a `building_type` field on each row.
  - **Volume tested live** (2026-09-14, via a public Overpass mirror — `overpass-api.de` itself wasn't reachable from this environment): `building=house` alone returns **~85,879 ways** across the same metro bbox `clean_apartment_buildings.py` uses — ~25x the ~3,460 apartment buildings currently in the dataset. `detached`/`semidetached_house`/`terrace`/`residential` weren't fully counted (the mirror timed out repeatedly under load) but would add more on top.
  - **Tag quality**: sampled 15 `building=house` ways on Grand Ave (St. Paul) — most carry a full `addr:housenumber`/`addr:street`/`addr:city`/`addr:postcode`, but a handful have no address/name tags at all, so the existing reverse-geocode fallback (`_building_name_address` / Nominatim pass in `clean_apartment_buildings.py`) would need to run over a much larger unaddressed set than it does for apartments today.
  - **Implementation plan when picked up**:
    1. Pipeline: add the house-type Overpass query alongside the apartments one, tag `building_type: 'house'`, expect materially longer build time (bigger fetch + more reverse-geocode fallback calls) and watch for Overpass timeouts at this volume (may need to tile the bbox into sub-queries).
    2. Frontend: houses should NOT reuse the always-on apartment-buildings canvas layer as-is — at 85K+ points a static always-rendered layer would paint the map solid at city zoom. Gate it to only render below some zoom threshold (unlike apartments' current always-on behavior), and give it its own legend toggle, off by default.
    3. `MatchFinder`/`matchRegions.ts`'s region-anchor logic already works on "any building record," so once the data exists it picks up houses for free — no ranking-logic changes needed, just the data source and a `building_type` filter control.
    4. **Refresh cadence**: the pipeline now runs monthly (see Automated Refreshes), already a fine cadence for building footprints, so no separate schedule is needed. OSM is now queried locally via `pyosmium` (`pipeline/core/osm_extract.py`) rather than Overpass, so the volume/timeout concerns above came from Overpass-era testing; a house query would run against the local extract instead.
  - Still deferred (not started) — this is a scoping note for whoever picks it up next, not an in-progress task.

#### Known Cross-City Comparability Gaps (accepted, no fix available)
- **MPLS "housing production" isn't independent of MPLS "permits".** Minneapolis has no dedicated housing-production dataset, so `clean_housing_mpls.py` derives it by filtering the same CCS_Permits feed used for MPLS's own `permit_rate_pc` metric (`permitType='Res'`). St. Paul's housing and permits metrics come from genuinely separate datasets. Result: MPLS's Amenities "housing" and Opportunity "permits" sub-metrics are near-duplicates of each other, while St. Paul's are not — when both are pooled into the shared z-scored `housing_rate_pc`/`permit_rate_pc` metrics, the two cities aren't quite measuring the same thing. Deferred unless a dedicated MPLS housing-production source is found.
- **Pedestrian/cyclist crash data is a frozen 2016-2021 MnDOT snapshot** (`clean_crashes.py`) and is intentionally NOT run through `date_window.py`'s rolling-recency filter like crime/permits/requests/housing, since the feed has no newer records to filter toward. Applies equally to both cities (no cross-city bias), but it will silently drift further out of date as the rest of the pipeline's shared window keeps advancing. Revisit if MnDOT/MnDPS publish a newer VRU crash extract.

#### Data Science Extensions — Potential Next Steps (not started)
The project today is an ETL pipeline + composite-score dashboard, plus the home value prediction analysis above. These would extend it further toward a more data-science-forward portfolio piece, using the existing district-level historical data already collected:
- **Causal/driver analysis:** feature-importance or SHAP analysis of what actually drives the composite Health Score up or down per district — turns pipeline output into an inferential story, not just a dashboard.
- **Clustering neighborhoods:** k-means or hierarchical clustering on existing district features to find "neighborhood archetypes" (e.g. "affordable + safe but low amenity" vs. "high opportunity + high cost") instead of just a single blended score. Demonstrates unsupervised ML.
- **Anomaly/outlier detection:** flag districts where the score changed sharply year-over-year and dig into why — ties into the historical trend charts already on the site.
- **Time-series forecasting:** ARIMA/Prophet forecast of a specific metric (crime, permits, home values) by district — extends the "map" project into a forecasting portfolio piece.

#### Troubleshooting
- **"CENSUS_API_KEY not found"** → Set env var or add to `.env` file
- **"Census API returned no data"** → Verify key is valid at https://api.census.gov/data/key_signup.html
- **"Crime/Permits/etc. from ArcGIS failed"** → ArcGIS temporarily down, will retry on next run
- **"No neighborhoods matched to districts"** → Spatial join issue with boundaries, check boundary geometries
- **Slow first run** → Normal, fetching all historical data (~5-10 min). Subsequent runs faster due to HTTP caching