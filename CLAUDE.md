# Github Directory Overview

## Projects

### 1. StPaulNeighborhoodHealth
**Status:** Active data science project  
**Goal:** Create a comprehensive neighborhood health assessment for St. Paul

#### Datasets (4 sources from St. Paul open data)
- **Building Permits** (~130MB, 318K rows) - Development activity, investment, property values
- **Crime Incidents** (~82MB, 561K rows) - Public safety metrics by neighborhood/time
- **Housing Production** (~0.8MB) - Housing supply tracking
- **Service Requests** (~57MB, 281K rows) - Infrastructure needs, resident complaints

#### Key Metrics Being Developed
- **Neighborhood Health Score** - Composite metric combining:
  - Safety (crime rate per capita)
  - Opportunity (development/permits per capita)
  - Quality of Life (service requests, housing production)
- Geographic disparities and trends over time
- Cluster analysis of neighborhoods

#### Project Structure
```
notebooks/
├── 01_README.ipynb          # Project overview & quick start
├── 02_EDA.ipynb             # Exploratory data analysis
├── 03_Data_Cleaning.ipynb   # Standardization & preprocessing
├── 04_PROJECT_PLAN.ipynb    # Strategic planning
├── 05_METHODOLOGY.ipynb     # Analysis approach
└── 06_CODE_SNIPPETS.ipynb   # Reusable code examples
data/                        # 4 CSV files
```

#### Geographic Identifiers
- **Crime:** NEIGHBORHOOD_NUMBER (17 unique), NEIGHBORHOOD_NAME (34 variations)
- **Permits:** Ward (7), District Council (17)
- **Requests:** Ward (39), District Council (49)
- All datasets have lat/long coordinates for mapping

---

## Vercel Deployment Recommendation: ✅ YES, Good Fit

### Why Vercel Free Tier Works
- **Perfect for:** Interactive data visualization dashboard
- **Built-in support:** React, Next.js, static exports
- **Ideal libraries:** Recharts, Plotly, D3, Mapbox (for neighborhood maps)
- **Deployment:** Zero-config, auto-deploy on git push
- **Performance:** Fast CDN, great for interactive dashboards

### Implementation Path
1. **Option A (Simplest):** Next.js app with embedded data JSON → Vercel (5min setup)
2. **Option B (Scalable):** Next.js + API routes → Pre-compute aggregated metrics, serve dynamically
3. **Option C (Advanced):** React dashboard + external data API (separate backend if needed)

### Free Tier Limits to Know
- **Serverless functions:** 100 invocations/day (sufficient for dashboard with client-side visualization)
- **Bandwidth:** Generous for dashboards
- **Data:** Host processed/aggregated data files (~MB range) easily
- **Real-time:** Not available on free tier; pre-computed data is the way to go

### Recommended Approach for Your Data
1. Use Jupyter notebooks to compute aggregated neighborhood health scores (CSVs)
2. Export results as JSON files
3. Build React/Next.js visualization dashboard
4. Deploy to Vercel
5. Dashboard loads data client-side and renders interactive charts/maps

This keeps everything fast, cheap, and simple.
