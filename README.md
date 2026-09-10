# Twin Cities Living Quality Map

An interactive map comparing quality of life across St. Paul's 17 District Councils and Minneapolis's 11 Communities, built from city open data, OpenStreetMap, the U.S. Census, MnDOT, and CDC.

**Live Dashboard:** deployed on Vercel — see the repository's GitHub Pages/Vercel link.

---

## What is a Health Score?

A **Health Score** (0–100, where 100 is excellent) measures how well a district is doing across four weighted components:

1. **Safety (35%)** — crime rate and pedestrian/cyclist crash rate (both inverted: lower is better)
2. **Opportunity (25%)** — building permit rate (higher is better) and unemployment rate (inverted)
3. **Quality of Life (20%)** — service requests and traffic volume (inverted), plus housing production, trails, transit stops, schools, grocery stores, healthcare access, and chronic disease burden (inverted)
4. **Affordability (20%)** — Census median home value, rent, and poverty rate (inverted), plus median household income and homeownership rate

Each metric is normalized against every other district (z-score, squashed to 0–100) and blended by weight. See the in-app **[How we calculate this](/methodology)** page for full detail.

---

## How to Use the Map

1. **Color by any metric** — use the "Color districts by" selector to recolor the map by Overall Health Score or any individual component index.
2. **Click a district** — view its full score breakdown, click any component score to see what feeds it (and a small trend chart, where historical data exists), and see housing affordability figures.
3. **Toggle data layers** — crime, transit, schools, grocery stores, and trails render as map markers/lines; toggle each on/off from the layers control.
4. **Search an address** — drops a labeled marker and filters nearby data-point markers to a 1-mile radius; click the marker again to clear it.
5. **Resize the sidebar** — drag the handle on the left edge of the detail panel.

---

## Data Sources

| Source | Used for |
|---|---|
| [City of St. Paul Open Data](https://information.stpaul.gov/) | Crime, permits, service requests, housing production |
| [City of Minneapolis Open Data](https://opendata.minneapolismn.gov/) | Crime, permits, service requests, housing production |
| [OpenStreetMap](https://www.openstreetmap.org/) (via [Overpass API](https://overpass-api.de/)) | Trails, transit stops, schools, grocery stores, healthcare facilities |
| [U.S. Census Bureau ACS 5-Year Estimates](https://www.census.gov/programs-surveys/acs) | Median home value/rent/income, poverty rate, housing cost burden, homeownership rate, unemployment rate |
| [MnDOT](https://www.dot.state.mn.us/traffic/data/) | Annual Average Daily Traffic (AADT), pedestrian/cyclist crash locations |
| [CDC PLACES](https://www.cdc.gov/places/) | Obesity and diabetes prevalence by census tract |

Some sources are intentionally excluded from the map's point layers (permits, service requests, housing production) — too granular for the map — but still feed the Health Score.

**Known limitations:**
- St. Paul's crime data has no geocoded address, only a district, so individual incidents aren't plotted as markers (Minneapolis crime does include coordinates).
- Minneapolis's 311 service request dataset only covers 2025, so no multi-year trend is available for that metric in that city.
- Pedestrian/cyclist crash data covers 2016–2021 (the most recent public MnDOT extract); it is not live.

---

## For Developers: How This Works

### Architecture

```
Twin Cities Living Quality Map
├── pipeline/                    (data processing, run locally or via GitHub Actions)
│   ├── load.py                  (fetch raw CSVs / boundary GeoJSON)
│   ├── clean_*.py               (standardize, geocode, join to districts, one file per source)
│   ├── aggregate.py             (compute per-district per-capita rates)
│   ├── health_score.py          (apply the scoring formula)
│   ├── build.py                 (orchestrate: aggregate → score → output neighborhoods*.json)
│   ├── export_points.py         (point/line map layers)
│   ├── export_affordability*.py (Census affordability snapshot + multi-year trend)
│   ├── export_timeseries.py     (crime/permits/requests/housing trend data)
│   ├── config/                  (sources.json, sources_mpls.json, weights.json)
│   └── tests/                   (pytest unit tests for the scoring math)
├── web/                         (Next.js frontend, deployed on Vercel)
│   ├── app/                     (pages: map, /trends, /methodology, /about)
│   ├── components/              (NeighborhoodMap, Legend, Sidebar, trend charts)
│   ├── lib/                     (ColorScale, data loading, metric labels)
│   ├── e2e/                     (Playwright end-to-end tests)
│   └── public/data/             (generated JSON/GeoJSON consumed by the frontend)
└── .github/workflows/           (scheduled data refresh + CI)
```

### Running Locally

#### Prerequisites
- Python 3.9+, pip
- Node.js 18+, npm
- A free [Census API key](https://api.census.gov/data/key_signup.html), saved to `pipeline/.env` as `CENSUS_API_KEY=...` (gitignored)

#### Pipeline (regenerate all data)
```bash
cd pipeline
pip install -r requirements.txt
python build.py                        # health scores for both cities
python export_points.py                # map point/line layers
python export_affordability.py         # affordability snapshot
python export_affordability_timeseries.py
python export_timeseries.py            # crime/permits/requests/housing trends
```

#### Pipeline tests
```bash
cd pipeline
pip install -r requirements-dev.txt
python -m pytest tests/ -v
```

#### Frontend (local dev server)
```bash
cd web
npm install
npm run dev
```
Open `http://localhost:3000` in your browser.

#### Frontend end-to-end tests
```bash
cd web
npx playwright install --with-deps chromium
npm run test:e2e
```

#### Deployment
Push to `main` → Vercel auto-deploys. A scheduled GitHub Actions workflow (`.github/workflows/refresh-data.yml`) re-runs the pipeline and commits refreshed data on the 1st and 15th of each month.

---

## Configuration Files

### `pipeline/config/sources.json` / `sources_mpls.json`
Extensible per-city registry of data sources. Each entry defines:
- `id` / `loader_module`: unique identifier and the Python module that cleans it
- `geo_join_method`: how records are mapped to districts (spatial join, crosswalk, point-in-polygon, line-intersection)
- `rate_direction`: `"direct"` (higher = better) or `"invert"` (higher = worse)
- `health_component`: which index this feeds (`safety`, `opportunity`, `quality_of_life`)
- `weight_in_component`: relative weight within that component

Adding a new data source: create a `clean_<source>.py` loader, add one entry to `sources.json` (and `sources_mpls.json` for city parity), then re-run `pipeline/build.py`.

### `pipeline/config/weights.json`
Health score component weights (currently 35% Safety / 25% Opportunity / 20% Quality of Life / 20% Affordability) and each component's formula description.

---

## License

Data is governed by each source's own terms (City of St. Paul, City of Minneapolis, OpenStreetMap, U.S. Census Bureau, MnDOT, CDC). Code in this repository is available under the MIT License.
