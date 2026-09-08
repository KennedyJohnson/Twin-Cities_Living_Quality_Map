# St. Paul Neighborhood Health Map

An interactive map showing the health and vitality of all 17 St. Paul District Councils, built from city open data.

**Live Dashboard:** [st-paul-health.vercel.app](https://st-paul-health.vercel.app) *(deployed on Vercel)*

---

## What is a Neighborhood Health Score?

A **Health Score** (0–100, where 100 is excellent) measures how well a neighborhood is doing across three dimensions:

1. **Safety** (40% of score)
   - Lower crime rates = higher safety score
   - Data source: St. Paul Crime Incidents (5-year aggregated)

2. **Opportunity** (30% of score)
   - More building permits = more development and investment
   - Data source: St. Paul Building Permits (5-year aggregated)

3. **Quality of Life** (30% of score)
   - Fewer service requests (potholes, streetlights, etc.) = better QoL
   - Data source: St. Paul Service Requests (5-year aggregated)

Each metric is scaled to 0–100, then combined with the weights above. A district with a score of **75** is doing well across safety, opportunity, and QoL. A score of **25** suggests challenges that warrant attention.

---

## How to Use the Map

1. **View by Color**
   - **Blue shades:** Lower health scores (challenges)
   - **Orange shades:** Higher health scores (strong vitality)
   - **White:** Moderate scores

2. **Click a District**
   - Click any district on the map to see a detailed breakdown
   - View the three component scores (Safety, Opportunity, QoL)
   - See the raw metrics behind each component

3. **Interact**
   - Hover over districts for visual feedback
   - Use your mouse to pan and zoom the map

---

## Data Sources

All data comes from **St. Paul's Open Data Portal** and is aggregated to the 17 District Council boundaries (the city's official neighborhood unit).

### Crime Incidents
- **What:** Police-reported crime incidents (all types)
- **Time period:** Last 5 years (aggregated)
- **How it's used:** Crime rate per 1,000 residents
- **Source:** St. Paul Police Department public data
- **Note:** Represents reported crime only; reflects reporting patterns as well as incident frequency

### Building Permits
- **What:** Residential, commercial, and industrial construction/renovation permits
- **Time period:** Last 5 years (aggregated)
- **How it's used:** Permit rate per 1,000 residents (proxy for economic activity)
- **Source:** St. Paul Building and Safety Department
- **Note:** Represents formal permitted development; does not include unpermitted work

### Service Requests
- **What:** Resident-submitted requests for infrastructure maintenance (potholes, streetlights, graffiti, etc.)
- **Time period:** Last 5 years (aggregated)
- **How it's used:** Request rate per 1,000 residents (inverted; more requests = lower QoL score)
- **Source:** St. Paul's 311 system and related channels
- **Note:** Reflects resident reporting behavior as much as actual infrastructure condition

### Housing Production
- **What:** New housing units created
- **Time period:** Last 5 years (aggregated)
- **How it's used:** Incorporated into the QoL Index where data is available
- **Source:** St. Paul Housing Authority and development tracking
- **Status:** Data availability is limited for v1; see limitations below

---

## Limitations

- **Time scope:** This is a snapshot of the last 5 years, not a trend over time. A future version may add year-slider to show changes.
- **Causation vs. correlation:** The Health Score combines three independent metrics; correlation between them does not imply causation.
- **Reporting bias:** Crime and service request data reflect what is *reported*, not necessarily what is true. Some districts may report more actively than others.
- **Housing data:** Housing production data availability is limited; the Housing Production source is not included in the initial QoL Index calculation.
- **Snapshot**: Data in this dashboard is regenerated periodically; it may not reflect very recent changes.

---

## For Developers: How This Works

### Architecture

```
St. Paul Neighborhood Health
├── notebooks/              (exploratory analysis, ignored in production)
├── pipeline/               (data processing, run locally)
│   ├── load.py             (fetch raw CSVs from city open data)
│   ├── clean_*.py          (standardize, geocode, join to districts)
│   ├── aggregate.py        (compute per-district rates)
│   ├── health_score.py     (apply canonical formula)
│   └── build.py            (orchestrate & output JSON)
├── web/                    (Next.js frontend, deployed on Vercel)
│   ├── app/                (React components, pages)
│   ├── components/         (NeighborhoodMap, Legend, Sidebar)
│   ├── lib/                (ColorScale, data loading, labels)
│   ├── types/              (TypeScript interfaces)
│   └── public/data/        (neighborhoods.json, boundaries.geojson)
└── README.md               (this file)
```

### Data Pipeline

1. **Load** (`load.py`)
   - Fetch Crime, Permits, Requests, Housing CSVs from St. Paul open data portal
   - Fetch District Council boundaries (GeoJSON) from city/county GIS

2. **Clean** (`clean_*.py` files)
   - Standardize column names, data types, coordinate systems
   - Map each incident/permit/request to a district ID via spatial join or fuzzy matching
   - Validate coordinates and filter invalid records

3. **Aggregate** (`aggregate.py`)
   - Count incidents, permits, requests per district
   - Compute per-capita rates (count / population * 1000)
   - Registry-driven: extensible to new data sources

4. **Score** (`health_score.py`)
   - Normalize each metric to 0–100 scale
   - Compute Safety Index, Opportunity Index, Quality of Life Index
   - Combine indices using configured weights
   - Output: 0–100 Health Score per district

5. **Publish** (`build.py`)
   - Write neighborhoods.json (metric data per district)
   - Write boundaries.geojson (geographic shapes with styling metadata)
   - Sanity-check totals and missing values
   - Commit JSON to git

### Frontend

- **Framework:** Next.js 14 (React) + TypeScript
- **Mapping:** Leaflet + OpenStreetMap (free, open-source, no API key needed)
- **Choropleth:** Leaflet GeoJSON layers with dynamic feature styling
- **Color scale:** Diverging Blue–Orange (colorblind-safe)
- **Deployment:** Vercel (zero-config, auto-deploys on git push)

### Running Locally

#### Prerequisites
- Python 3.9+, pip
- Node.js 18+, npm

#### Pipeline (local, manual)
```bash
cd pipeline
pip install -r requirements.txt
python build.py
```
This regenerates `web/public/data/neighborhoods.json` and `web/public/data/boundaries.geojson`.

#### Frontend (local dev server)
```bash
cd web
npm install
echo "NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=YOUR_KEY_HERE" > .env.local
npm run dev
```
Open `http://localhost:3000` in your browser.

#### Deployment
Push to GitHub → Vercel auto-deploys (configured to watch `main` branch).

---

## Configuration Files

### `pipeline/config/sources.json`
Extensible registry of data sources. Each entry defines:
- `id`: unique identifier
- `loader`: Python module name for data loading
- `geo_join_method`: how to map records to districts
- `rate_direction`: whether higher metric = better ("opportunity") or worse ("safety")
- `health_component`: which index this feeds into (safety, opportunity, quality_of_life)

Adding a new data source requires:
1. Create a new `clean_<source>.py` loader
2. Add one entry to `sources.json`
3. Re-run `pipeline/build.py`

### `pipeline/config/weights.json`
Health score component weights. Default: 0.40 Safety, 0.30 Opportunity, 0.30 QoL. Modifiable without code changes.

---

## Contributing

Have data or methodology improvements? Open an issue or pull request on GitHub.

---

## License

Data from St. Paul Open Data Portal is governed by the [City of St. Paul's open data terms](https://www.data.stpaul.gov/). Code in this repository is available under the MIT License.

---

## Contact

Questions about this project? Reach out via GitHub Issues.

---

**Last Updated:** September 2026  
**Data Snapshot:** Last 5 years aggregated (2021–2026)
