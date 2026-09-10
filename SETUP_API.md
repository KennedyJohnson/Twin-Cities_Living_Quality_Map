# API-Based Data Loading Setup

This document explains how to set up automated data fetching from city APIs instead of manually downloading CSVs.

## Overview

The pipeline now supports automatic data fetching from **Socrata APIs** for St. Paul and **ArcGIS FeatureServers** for Minneapolis. When API dataset IDs are configured, the pipeline fetches data directly from official sources on each run.

### Data Sources

| City | Source | Status | Setup |
|------|--------|--------|-------|
| **St. Paul** | Socrata API | ✅ Automated (optional) | Requires dataset IDs |
| **St. Paul** | Local CSVs | ✅ Fallback | Drop CSVs in `/data/` |
| **Minneapolis** | ArcGIS FeatureServer | ✅ Automated | No setup needed |
| **All** | Census API | ✅ Automated | Free key required |

## Quick Start

### Option A: Use Local CSVs (No Setup Required)

Simply place the CSV files in the `/data/` directory:
- `Crime_Incident_Report.csv`
- `Approved_Building_Permits_*.csv`
- `Resident_Service_Requests_*.csv`
- `Housing_Production.csv`

The pipeline will use these files when API dataset IDs are not configured.

### Option B: Enable St. Paul Socrata APIs (Recommended)

#### Step 1: Get Census API Key

1. Visit: https://api.census.gov/data/key_signup.html
2. Sign up for a free Census API key
3. Save the key (you'll need it in Step 3)

#### Step 2: Discover St. Paul Dataset IDs

Run the discovery script:

```bash
cd pipeline
python diagnostics/discover_socrata_ids.py
```

This will guide you to find the Socrata dataset IDs from https://information.stpaul.gov/browse.

The script looks for datasets named:
- **Crime Incident Report** → `STPAUL_CRIME_ID`
- **Building Permits** (or "Approved Permits") → `STPAUL_PERMITS_ID`
- **Service Requests** (or "Resident Requests") → `STPAUL_REQUESTS_ID`
- **Housing Production** → `STPAUL_HOUSING_ID`

**How to find IDs manually:**
1. Go to https://information.stpaul.gov/browse
2. Search for and click on each dataset
3. Look for an "API" endpoint or "Export" button
4. Extract the dataset ID from the URL (the long alphanumeric string after `/api/views/`)
5. Save these IDs

#### Step 3: Configure Environment Variables

Create a file `pipeline/.env` (gitignored) with:

```bash
# Required for Census-based affordability metrics
CENSUS_API_KEY=your_census_key_here

# Optional: St. Paul Socrata dataset IDs (leave blank to use local CSVs)
STPAUL_CRIME_ID=your_crime_id
STPAUL_PERMITS_ID=your_permits_id
STPAUL_REQUESTS_ID=your_requests_id
STPAUL_HOUSING_ID=your_housing_id
```

Or copy from the template:

```bash
cp pipeline/.env.example pipeline/.env
# Edit pipeline/.env with your actual IDs and keys
```

#### Step 4: Test Locally

Run the pipeline to verify everything works:

```bash
cd pipeline
python build.py
```

You should see messages like:
```
[INFO] Attempting to load crime data from St. Paul Socrata API...
[OK] Loaded 5000 crime records from API
```

If API loading fails, it automatically falls back to local CSVs:
```
[WARNING] Failed to load crime from API: 404 Not Found. Falling back to CSV.
[INFO] Loading crime data from local CSV
```

#### Step 5: Configure GitHub Actions (Optional)

To enable API-based data fetching in GitHub Actions:

1. Go to your repository settings
2. Click **Secrets and variables** → **Actions**
3. Add new secrets:
   - `CENSUS_API_KEY` → Your Census API key
   - `STPAUL_CRIME_ID` → Dataset ID for crime
   - `STPAUL_PERMITS_ID` → Dataset ID for permits
   - `STPAUL_REQUESTS_ID` → Dataset ID for requests
   - `STPAUL_HOUSING_ID` → Dataset ID for housing

The workflow will automatically use these when running the scheduled data refresh (1st and 15th of each month).

## Architecture

### Data Loading Flow

```
pipeline/build.py
  ↓
core/load.py (load_crime, load_permits, etc.)
  ├─ Try: core/socrata.py → fetch from API (if env vars set)
  └─ Fallback: CSV from /data/
```

### New Components

- **`pipeline/core/socrata.py`** - Socrata API client with pagination and caching
- **`pipeline/config/stpaul_sources.json`** - Dataset configuration and setup instructions
- **`pipeline/.env.example`** - Template for environment variables
- **`pipeline/diagnostics/discover_socrata_ids.py`** - Script to find dataset IDs

### Backwards Compatibility

The system is fully backwards compatible:
- If no Socrata IDs are configured, loaders use local CSVs
- Local CSVs still work (place in `/data/` directory)
- No changes required to existing cleaners or pipeline code

## Troubleshooting

### "Crime file not found" Error

**Solution:** Either:
1. Set `STPAUL_CRIME_ID` environment variable and ensure dataset is accessible, OR
2. Download CSV and place in `/data/Crime_Incident_Report.csv`

### API Returns 404 or Empty Results

**Check:**
- Dataset ID is correct (visit https://information.stpaul.gov/browse to verify)
- Dataset is public/accessible
- Socrata API is responding: `curl https://information.stpaul.gov/api/views/{ID}/rows.json`

### Slow API Requests

The pipeline uses HTTP caching (`core/http_cache.py`):
- Responses are cached for the session
- Same request within minutes uses cache (no re-fetch)
- Cache expires per-request (conservative approach)

## Example Configuration Scenarios

### Scenario 1: Development with Local CSVs

```bash
# Just copy CSV files to /data/
# No environment variables needed
python pipeline/build.py  # Uses local CSVs
```

### Scenario 2: Production with Socrata APIs

```bash
# Set environment variables
export STPAUL_CRIME_ID=xxx
export STPAUL_PERMITS_ID=xxx
export STPAUL_REQUESTS_ID=xxx
export STPAUL_HOUSING_ID=xxx
export CENSUS_API_KEY=xxx

python pipeline/build.py  # Fetches from Socrata APIs
```

### Scenario 3: Hybrid (API with CSV Fallback)

```bash
# Set dataset IDs (will try API first)
export STPAUL_CRIME_ID=xxx
export STPAUL_PERMITS_ID=xxx
# Leave requests/housing IDs unset

# Keep local CSVs as fallback
cp old_data.csv /data/Resident_Service_Requests.csv
cp old_housing.csv /data/Housing_Production.csv

python pipeline/build.py  # Crime/permits from API, others from CSV
```

## API Rate Limits

- **St. Paul Socrata:** ~60,000 rows per day per IP
- **Census API:** ~40,000 calls/day per API key
- **MnDOT ArcGIS:** No published limit (use respectfully)

For large datasets, the pagination in `socrata.py` automatically handles this by fetching 10,000 rows at a time.

## Next Steps

1. ✅ [Complete Option A or B above]
2. 📝 Test the pipeline locally
3. 🔐 Add secrets to GitHub Actions
4. 🚀 Data will refresh automatically on the 1st and 15th of each month

## Questions?

See:
- `pipeline/config/stpaul_sources.json` - Dataset configuration details
- `pipeline/core/socrata.py` - API client implementation
- `README.md` - General project documentation
