# Github Directory Overview

## Projects

### 1. Twin Cities Living Quality Map
**Goal:** Create a comprehensive, comparable living-quality assessment across St. Paul (17 District Councils) and Minneapolis (11 Communities)

#### Datasets
- City of St. Paul & City of Minneapolis Open Data: Crime, Building Permits, Service Requests, Housing Production
- OpenStreetMap (via Overpass API): trails, transit stops, schools, grocery stores, healthcare facilities
- U.S. Census Bureau ACS 5-Year Estimates: median home value/rent/income, poverty rate, housing cost burden, homeownership rate, unemployment rate
- MnDOT: Annual Average Daily Traffic (AADT), pedestrian/cyclist crash locations
- CDC PLACES: obesity/diabetes prevalence by census tract

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
pipeline/                    # Data processing (build.py orchestrates cleaners/ -> core/ -> exports/; see README.md for full layout)
web/                         # Next.js frontend (deployed on Vercel), includes app/icon.svg favicon
data/                        # Raw St. Paul CSVs (gitignored, local only)
.github/workflows/           # Scheduled data refresh + CI
```
See `README.md` for the full architecture and how to run the pipeline/frontend locally.

#### Geographic Identifiers
- **St. Paul:** District Council (1-17)
- **Minneapolis:** Community (101-111), joined via a neighborhood→community crosswalk
- District_id ranges (1-17 vs 101-111) distinguish the two cities in shared frontend/pipeline code