# Github Directory Overview

## Projects

### 1. Twin Cities Living Quality Map
**Goal:** Create a comprehensive, comparable living-quality assessment across St. Paul (17 District Councils) and Minneapolis (11 Communities)

#### Datasets (100% API-Based Automation)
All data is fetched automatically from official APIs with no manual downloads:
- **City Data** (ArcGIS FeatureServers): Crime, Building Permits, Service Requests, Housing Production
- **Census Data** (Census Bureau API): Population, Unemployment, Median home value/rent/income, poverty rate, housing cost burden, homeownership rate
- **Geographic** (ArcGIS FeatureServers): District boundaries, neighborhood→district crosswalks (generated dynamically)
- **Mapping** (OpenStreetMap Overpass API): Trails, transit stops, schools, grocery stores, healthcare facilities
- **Traffic** (MnDOT ArcGIS): Annual Average Daily Traffic (AADT), pedestrian/cyclist crash locations
- **Health** (CDC Socrata): Obesity/diabetes prevalence by census tract

**Setup:** Only requires `CENSUS_API_KEY` environment variable (free from census.gov). See [SETUP_API.md](SETUP_API.md).

#### Key Metrics Being Developed
- **Health Score** - Composite metric (0-100) combining four weighted components:
  - Safety (35%): crime rate + pedestrian/cyclist crash rate
  - Opportunity (25%): permit rate + unemployment rate
  - Quality of Life (20%): service requests, traffic volume, chronic disease burden (inverted), plus housing production, trails, transit, schools, groceries, healthcare access
  - Affordability (20%): home value, rent, poverty rate, housing cost burden (inverted), plus household income and homeownership rate
- Multi-year trend charts for crime/permits/requests/housing and Census affordability figures
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
```

#### Automated Refreshes
- **Local:** Run `python build.py` anytime
- **GitHub Actions:** Auto-runs 1st & 15th of each month (requires `CENSUS_API_KEY` secret)

#### Geographic Identifiers
- **St. Paul:** District Council (1-17)
- **Minneapolis:** Community (101-111), joined via a neighborhood→community crosswalk
- District_id ranges (1-17 vs 101-111) distinguish the two cities in shared frontend/pipeline code

#### Key Implementation Notes
- **100% API-Based:** All data loaded from official APIs (ArcGIS FeatureServers, Census Bureau, OpenStreetMap, CDC, MnDOT)
- **No Local Data Files:** Population, boundaries, and crosswalks generated/fetched dynamically from APIs
- **Automatic Pagination:** Large datasets paginated (10K rows per request) with built-in HTTP caching
- **Graceful Degradation:** If an API is down, pipeline logs warning and continues with other datasets
- **Dynamic Crosswalks:** Neighborhood→District mappings generated via spatial joins from crime data coordinates

#### Troubleshooting
- **"CENSUS_API_KEY not found"** → Set env var or add to `.env` file
- **"Census API returned no data"** → Verify key is valid at https://api.census.gov/data/key_signup.html
- **"Crime/Permits/etc. from ArcGIS failed"** → ArcGIS temporarily down, will retry on next run
- **"No neighborhoods matched to districts"** → Spatial join issue with boundaries, check boundary geometries
- **Slow first run** → Normal, fetching all historical data (~5-10 min). Subsequent runs faster due to HTTP caching