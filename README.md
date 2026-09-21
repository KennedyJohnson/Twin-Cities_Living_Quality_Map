# Twin Cities Living Quality Map

An interactive map comparing quality of life across St. Paul's 17 District Councils and Minneapolis's 11 Communities, built from city open data, OpenStreetMap, the U.S. Census, MnDOT, and CDC.

**Live Dashboard:** deployed on Vercel (Next.js frontend in `web/`).

---

## Quick Start (Development)

Get the pipeline running locally in 5 minutes:

```bash
# 1. Get free Census API key (2 min)
#    Visit: https://api.census.gov/data/key_signup.html
#    → Check email for key

# 2. Set up environment
cp pipeline/.env.example pipeline/.env
# Edit pipeline/.env and add: CENSUS_API_KEY=your_key_here

# 3. Run pipeline
cd pipeline
python build.py

# Done! Data fetched from APIs automatically
```

**All data is fetched automatically from official APIs — no manual downloads needed.**

---

## What is the Living Quality Score?

A **Living Quality Score** (0–100, where 100 is excellent) measures how well a district is doing across five equally weighted (20% each) components:

1. **Safety** — crime rate, pedestrian/cyclist crash rate, FEMA natural hazard risk, and chronic disease burden (CDC PLACES) — all inverted: lower is better
2. **Opportunity** — building permit rate, unemployment rate (inverted), and Zillow for-sale inventory (fewer listings = tighter market = higher), blended 85/15 with the share of adults with a bachelor's degree or higher
3. **Amenities & Services** — schools, grocery stores, restaurants/bars, healthcare, and entertainment venues (OpenStreetMap), blended 85/15 with a Census broadband/internet-access rate
4. **Transportation** — trail/path length and transit stop rate minus traffic volume (inverted), blended 60/25/15 with a Walk/Bike Score and a Census commute score (commute time and transit/walk/bike share)
5. **Economic Profile** — home value, rent, poverty rate, housing cost burden, income inequality (Gini), and vacancy rate (all inverted), plus median household income and homeownership rate. (Formerly "Affordability"; renamed because it blends cost with income/ownership.)

Each metric is z-scored and squashed to 0–100 independently, then weight-blended. Normalization is pooled across all 28 districts of **both** cities, so St. Paul and Minneapolis scores are directly comparable. Crime and permit counts use a shared trailing recent-years window. Full detail is in `pipeline/config/weights.json` and the in-app **[About](/about)** page.

---

## How to Use the Map

1. **Color by any metric** — use the "Color districts by" selector to recolor the map by the overall score, any component index, or an individual underlying metric.
2. **Click a district** — view its full score breakdown, click any component score to see what feeds it (and a small trend chart, where historical data exists), see housing affordability figures, and see a bar chart comparing the district against its city's average on each component.
3. **Toggle data layers** — crime, transit, schools, grocery stores, apartment buildings, and trails render as map markers/lines; toggle each on/off from the layers control.
4. **Click anywhere on the map, or search an address** — drops a labeled marker, filters nearby data-point markers to a 1-mile radius, and computes a 1-mile-radius Living Quality Score from OpenStreetMap + Census data (its own sidebar panel, comparable to district scores but excluding metrics only available at the district level); click the marker again to clear it.
5. **Compare & match** — compare districts side by side, or use **Find Your Match** to rank areas against your preferences.
6. **Trends page** (`/trends`) — multi-year trends and biggest movers.
7. **Resize the sidebar** — drag the handle on the left edge of the detail panel.

---

## Data Sources

| Source | Used for |
|---|---|
| [City of St. Paul](https://information.stpaul.gov/) | Crime, permits |
| [City of Minneapolis](https://opendata.minneapolismn.gov/) | Crime, permits |
| [OpenStreetMap](https://www.openstreetmap.org/) (local Geofabrik Minnesota extract via `pyosmium`) | Trails, transit stops, schools, groceries, restaurants/bars, healthcare, entertainment venues, apartment buildings, street network (Walk/Bike Score), place search |
| [U.S. Census Bureau ACS](https://www.census.gov/programs-surveys/acs) | Population, unemployment, home value/rent/income, poverty, cost burden, homeownership, Gini, vacancy, education, broadband, commute |
| Zillow | For-sale housing inventory |
| [FEMA](https://hazards.fema.gov/nri/) | Natural hazard risk |
| [MnDOT](https://www.dot.state.mn.us/traffic/data/) | Annual Average Daily Traffic (AADT), pedestrian/cyclist crash locations |
| [CDC PLACES](https://www.cdc.gov/places/) | Chronic disease (obesity/diabetes) prevalence by census tract |

**Fully automated:** All data is fetched from official APIs with no manual downloads. The only required key is the free Census API key.

Some sources are intentionally excluded from the map's point layers (permits) — too granular for the map — but still feed the score.

**Known limitations:**
- St. Paul's crime data has no geocoded address, only a district, so individual incidents aren't plotted as markers (Minneapolis crime does include coordinates).
- Pedestrian/cyclist crash data covers 2016–2021 (the most recent public MnDOT extract); it is not live.
- **Housing Production and Service Requests were removed from the score** (see `pipeline/config/weights.json`) after an audit found the two cities' source datasets weren't comparable: Minneapolis has no dedicated housing-production dataset (its residential-permit proxy undercounted new units ~5x vs. St. Paul's purpose-built dataset), and St. Paul's Service Requests dataset is scoped narrowly to livability complaints while Minneapolis's 311 feed is a much broader contact-center system covering categories St. Paul doesn't track and logging the same complaint across multiple intake channels.

---

## Development & Setup

### Prerequisites
- Python 3.11+
- Census API key (free, 2 min to get): https://api.census.gov/data/key_signup.html
- No manual data downloads needed — all APIs are automated

### Local Development (5 minutes)

```bash
# 1. Clone and navigate
git clone <repo>
cd Twin-Cities_Living_Quality_Map

# 2. Install dependencies
pip install -r pipeline/requirements.txt

# 3. Set up environment
cp pipeline/.env.example pipeline/.env
# Edit pipeline/.env: paste your Census API key
# CENSUS_API_KEY=your_key_here

# 4. Run the pipeline
cd pipeline
python build.py

# 5. All data fetched from APIs automatically
# Generated files appear in: web/public/data/neighborhoods*.json
```

### Run Frontend Locally

```bash
cd web
npm install
npm run dev

# Visit: http://localhost:3000
```

### GitHub Actions (Automated Updates)

Scheduled to run **monthly, 08:00 UTC on the 1st** (`.github/workflows/refresh-data.yml`; matches the 30-day OSM extract refresh):

1. Add secret to GitHub: **Settings** → **Secrets and variables** → **Actions**
   - Name: `CENSUS_API_KEY`
   - Value: your Census API key
2. Done! Pipeline auto-fetches and deploys data

To manually trigger:
- **Actions** tab → **Refresh Pipeline Data** → **Run workflow**

---

## For Developers: How This Works

### Architecture

```
Twin Cities Living Quality Map
├── pipeline/                    (data processing, run locally or via GitHub Actions)
│   ├── build.py                 (orchestrate: aggregate → score → output neighborhoods*.json)
│   ├── cleaners/                (clean_*.py — standardize, geocode, join to districts, one file per source)
│   ├── core/                    (load.py, aggregate.py, health_score.py, walk_score.py, radius_score.py, osm_extract.py, date_window.py, http_cache.py)
│   ├── exports/                 (export_all.py, export_points.py, export_affordability*.py, export_timeseries.py, export_radius_baseline.py, export_place_index.py)
│   ├── diagnostics/             (diagnostic_geography.py, verify_crosswalk.py, discover_socrata_ids.py — standalone dev utilities)
│   ├── config/                  (sources.json, sources_mpls.json, weights.json, mpls_neighborhood_to_community.json, stpaul_sources.json)
│   ├── boundaries/, crosswalks/, data/ (raw boundary GeoJSON, geo crosswalks, population CSVs; /data/ is optional fallback)
│   └── tests/                   (pytest unit tests for the scoring math)
├── web/                         (Next.js frontend, deployed on Vercel)
│   ├── app/                     (pages: map, /trends, /about; icon.svg favicon)
│   ├── components/              (NeighborhoodMap, Legend, sidebars, MatchFinder, comparison/trend charts)
│   ├── lib/                     (ColorScale, radiusScore, matchRegions, data loading, metric labels)
│   ├── e2e/                     (Playwright end-to-end tests)
│   └── public/data/             (generated JSON/GeoJSON consumed by the frontend)
└── .github/workflows/           (scheduled data refresh + CI)
```

---

## Configuration Files

### `pipeline/config/sources.json` / `sources_mpls.json`
Extensible per-city registry of data sources. Each entry defines:
- `id` / `loader_module`: unique identifier and the Python module that cleans it
- `geo_join_method`: how records are mapped to districts (spatial join, crosswalk, point-in-polygon, line-intersection)
- `rate_direction`: `"direct"` (higher = better) or `"invert"` (higher = worse)
- `health_component`: which index this feeds (`safety`, `opportunity`, `amenities`, `transportation`, `affordability` — the Economic Profile key)
- `weight_in_component`: relative weight within that component

Adding a new data source: create a `cleaners/clean_<source>.py` loader, add one entry to `sources.json` (and `sources_mpls.json` for city parity), then re-run `pipeline/build.py`.

### `pipeline/config/weights.json`
Health score component weights (currently 20% Safety / 20% Opportunity / 20% Amenities & Services / 20% Transportation / 20% Economic Profile) and each component's formula description.

---

## License

Data is governed by each source's own terms (City of St. Paul, City of Minneapolis, OpenStreetMap, U.S. Census Bureau, MnDOT, CDC). Code in this repository is available under the MIT License.
