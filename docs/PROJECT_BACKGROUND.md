# Project Background

This document preserves the original planning context from this project's early research phase (formerly `notebooks/04_PROJECT_PLAN.ipynb`). The methodology and formulas described here were superseded during implementation — see the root [README.md](../README.md) for the actual, current Health Score formula and architecture.

## Research Question

How do building development, public safety, housing production, and service request patterns vary across St. Paul neighborhoods, and what do these patterns reveal about neighborhood health?

## Primary Questions

1. What is the health profile of each neighborhood?
2. How do neighborhoods cluster by characteristics?
3. Which neighborhoods are improving vs. declining?

## Secondary Questions

4. Does more development correlate with crime changes?
5. Are safer neighborhoods developing faster?
6. Where are service requests concentrated?
7. What types of problems are most common by area?
8. Are there geographic patterns or hotspots?
9. How have neighborhoods changed over the analysis period?

## Analysis Roadmap (5 Phases)

**Phase 1: Data Exploration & Cleaning**
- Understand all datasets, identify key columns
- Handle missing/invalid data
- Standardize neighborhood names

**Phase 2: Neighborhood Aggregation**
- Create neighborhood-year summaries
- Aggregate permits, crimes, requests
- Integrate housing data into a master dataframe

**Phase 3: Indicator Development**
- Calculate crime/safety metrics
- Quantify development activity
- Analyze service request patterns
- Create composite scores

**Phase 4: Analysis & Insights**
- Correlation analysis, trend analysis
- Clustering neighborhoods
- Hypothesis testing

**Phase 5: Visualization & Reporting**
- Create neighborhood rankings
- Build comparison charts
- Generate insights, document findings

## Project Timeline

| Phase | Timeline | Key Deliverables |
|-------|----------|------------------|
| 1. Exploration | Week 1 | EDA, data quality report |
| 2. Aggregation | Week 2-3 | Master neighborhood table |
| 3. Indicators | Week 3-4 | Health scores calculated |
| 4. Analysis | Week 4-5 | Correlations, trends, clusters |
| 5. Reporting | Week 5-6 | Visualizations, findings report |

Total estimated time: 4-6 weeks.

## Key Challenges & Solutions

| Challenge | Solution |
|-----------|----------|
| Neighborhood name mismatches | Create comprehensive mapping dictionary |
| Different geographic units | Identify common geography, standardize |
| Time period gaps | Document coverage, analyze overlapping periods |
| Missing population data | Use service requests as proxy or Census data |
| Data quality issues | Establish validation rules, document exclusions |

## Resources & References

**Data Sources:**
- St. Paul Open Data Portal: https://information.stpaul.gov/datasets
- US Census Bureau: population and demographic data
- Minnesota State Demographer: regional data

**Analysis Tools:**
- GeoPandas: geospatial analysis
- Folium: interactive maps
- Scikit-learn: clustering and statistics
