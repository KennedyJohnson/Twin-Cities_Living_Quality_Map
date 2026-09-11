export const metricLabels: Record<string, { label: string; unit: string; source: string; component: string; trendKey?: string }> = {
  crime_rate_pc: {
    label: 'Crime Rate',
    unit: 'incidents per 1,000 residents',
    source: 'City of St. Paul Open Data — Crime Incident Reports (2014–2026)',
    component: 'safety',
    trendKey: 'crime',
  },
  permit_rate_pc: {
    label: 'Permit Rate',
    unit: 'permits per 1,000 residents',
    source: 'City of St. Paul Open Data — Approved Building Permits (2015–2025)',
    component: 'opportunity',
    trendKey: 'permits',
  },
  permits_rate_pc: {
    label: 'Permit Rate',
    unit: 'permits per 1,000 residents',
    source: 'City of Minneapolis Open Data — Approved Building Permits',
    component: 'opportunity',
    trendKey: 'permits',
  },
  request_rate_pc: {
    label: 'Service Request Rate',
    unit: 'requests per 1,000 residents',
    source: 'City of St. Paul Open Data — Resident Service Requests (2015–2025)',
    component: 'amenities',
    trendKey: 'requests',
  },
  requests_rate_pc: {
    label: 'Service Request Rate',
    unit: 'requests per 1,000 residents',
    source: 'City of Minneapolis Open Data — 311 Service Requests',
    component: 'amenities',
    trendKey: 'requests',
  },
  housing_rate_pc: {
    label: 'Housing Production Rate',
    unit: 'units per 1,000 residents',
    source: 'City Open Data — Housing Production',
    component: 'amenities',
    trendKey: 'housing',
  },
  trail_km_pc: {
    label: 'Trail/Path Length',
    unit: 'km per 1,000 residents',
    source: 'OpenStreetMap (via Overpass API, live/current data)',
    component: 'transportation',
  },
  transit_stops_pc: {
    label: 'Transit Stop Rate',
    unit: 'stops per 1,000 residents',
    source: 'OpenStreetMap (via Overpass API, live/current data)',
    component: 'transportation',
  },
  schools_pc: {
    label: 'School Access Rate',
    unit: 'schools per 1,000 residents',
    source: 'OpenStreetMap (via Overpass API, live/current data)',
    component: 'amenities',
  },
  grocery_pc: {
    label: 'Grocery Store Access Rate',
    unit: 'stores per 1,000 residents',
    source: 'OpenStreetMap (via Overpass API, live/current data)',
    component: 'amenities',
  },
  traffic_vkm_pc: {
    label: 'Traffic Volume',
    unit: 'vehicle-km/day per 1,000 residents',
    source: 'MnDOT Annual Average Daily Traffic (current)',
    component: 'transportation',
  },
  unemployment_rate_pc: {
    label: 'Unemployment Rate',
    unit: 'unemployed residents per 1,000 residents',
    source: 'U.S. Census Bureau ACS 5-Year Estimates',
    component: 'opportunity',
  },
  housing_inventory_pc: {
    label: 'Housing Market Tightness',
    unit: 'for-sale listings per 1,000 residents',
    source: 'Zillow Research — For-Sale Inventory (monthly)',
    component: 'opportunity',
  },
  healthcare_pc: {
    label: 'Healthcare Access Rate',
    unit: 'facilities per 1,000 residents',
    source: 'OpenStreetMap (via Overpass API, live/current data)',
    component: 'amenities',
  },
  restaurants_pc: {
    label: 'Restaurant/Bar Access Rate',
    unit: 'venues per 1,000 residents',
    source: 'OpenStreetMap (via Overpass API, live/current data)',
    component: 'amenities',
  },
  chronic_disease_pc: {
    label: 'Chronic Disease Burden',
    unit: 'affected residents per 1,000 residents',
    source: 'CDC PLACES (obesity + diabetes prevalence, 2023)',
    component: 'safety',
  },
  crash_rate_pc: {
    label: 'Pedestrian/Cyclist Crash Rate',
    unit: 'crashes per 1,000 residents',
    source: 'MnDOT/MnDPS Vulnerable Road User Crash Data (2016–2021)',
    component: 'safety',
  },
  disaster_risk_pc: {
    label: 'Natural Hazard Risk',
    unit: 'risk-weighted residents per 1,000 pop',
    source: 'FEMA National Risk Index (18 natural hazards, composite score by census tract)',
    component: 'safety',
  },
};

export function getMetricLabel(metricName: string): string {
  return metricLabels[metricName]?.label || metricName;
}

export function getMetricUnit(metricName: string): string {
  return metricLabels[metricName]?.unit || 'per 1,000 residents';
}

export function getMetricSource(metricName: string): string {
  return metricLabels[metricName]?.source || 'Source unavailable';
}

export function getMetricTrendKey(metricName: string): string | undefined {
  return metricLabels[metricName]?.trendKey;
}

export function getMetricsForComponent(componentKey: string): string[] {
  return Object.entries(metricLabels)
    .filter(([, v]) => v.component === componentKey)
    .map(([k]) => k);
}

export const indexLabels: Record<string, string> = {
  safety: 'Safety',
  opportunity: 'Opportunity',
  amenities: 'Amenities & Services',
  transportation: 'Transportation',
  affordability: 'Affordability',
  walkability_score: 'Walk/Bike Score',
};

export const indexDescriptions: Record<string, string> = {
  safety: 'Comprised of: Crime Rate, Pedestrian/Cyclist Crash Rate, Natural Hazard Risk, and Chronic Disease Burden. Higher crime, more crashes, higher hazard risk, or higher chronic disease burden per capita lowers this index.',
  opportunity: 'Comprised of: Permit Rate and Unemployment Rate. More development raises this index; more unemployment lowers it.',
  amenities: 'Comprised of: Service Requests (inverted), plus Housing Production, Schools, Grocery Stores, Restaurants/Bars, and Healthcare Access where available.',
  transportation: 'Comprised of: Trail/Path Length and Transit Stop Rate (direct) minus Traffic Volume (inverted), blended 30% with the Walk/Bike Score below.',
  affordability: 'Comprised of: Census median home value, median gross rent, median household income, poverty rate, housing cost burden (% of income spent on rent), and homeownership rate. Lower home values/rent/poverty/cost-burden and higher income/homeownership (each relative to other districts) raise this index — see the Housing Affordability panel below for the raw figures.',
  walkability_score: 'A Zillow-style Walk/Bike Score: distance-decay proximity to groceries, restaurants/bars, transit, schools, and healthcare, plus street-intersection density (a block-size/bikeability proxy) and trail km per capita. Closer amenities, denser intersections, and more trails raise this score. Feeds 30% of the Transportation index.',
};

export const healthScoreMethodology =
  'Each index is built by normalizing its component metrics against all districts (z-score, then squashed to 0–100) and blending them by weight. The overall Health Score is a weighted average: 35% Safety + 25% Opportunity + 10% Amenities & Services + 10% Transportation + 20% Affordability.';
