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
    component: 'quality_of_life',
    trendKey: 'requests',
  },
  requests_rate_pc: {
    label: 'Service Request Rate',
    unit: 'requests per 1,000 residents',
    source: 'City of Minneapolis Open Data — 311 Service Requests',
    component: 'quality_of_life',
    trendKey: 'requests',
  },
  housing_rate_pc: {
    label: 'Housing Production Rate',
    unit: 'units per 1,000 residents',
    source: 'City Open Data — Housing Production',
    component: 'quality_of_life',
    trendKey: 'housing',
  },
  trail_km_pc: {
    label: 'Trail/Path Length',
    unit: 'km per 1,000 residents',
    source: 'OpenStreetMap (via Overpass API, live/current data)',
    component: 'quality_of_life',
  },
  transit_stops_pc: {
    label: 'Transit Stop Rate',
    unit: 'stops per 1,000 residents',
    source: 'OpenStreetMap (via Overpass API, live/current data)',
    component: 'quality_of_life',
  },
  schools_pc: {
    label: 'School Access Rate',
    unit: 'schools per 1,000 residents',
    source: 'OpenStreetMap (via Overpass API, live/current data)',
    component: 'quality_of_life',
  },
  grocery_pc: {
    label: 'Grocery Store Access Rate',
    unit: 'stores per 1,000 residents',
    source: 'OpenStreetMap (via Overpass API, live/current data)',
    component: 'quality_of_life',
  },
  traffic_vkm_pc: {
    label: 'Traffic Volume',
    unit: 'vehicle-km/day per 1,000 residents',
    source: 'MnDOT Annual Average Daily Traffic (current)',
    component: 'quality_of_life',
  },
  unemployment_rate_pc: {
    label: 'Unemployment Rate',
    unit: 'unemployed residents per 1,000 residents',
    source: 'U.S. Census Bureau ACS 5-Year Estimates',
    component: 'opportunity',
  },
  healthcare_pc: {
    label: 'Healthcare Access Rate',
    unit: 'facilities per 1,000 residents',
    source: 'OpenStreetMap (via Overpass API, live/current data)',
    component: 'quality_of_life',
  },
  chronic_disease_pc: {
    label: 'Chronic Disease Burden',
    unit: 'affected residents per 1,000 residents',
    source: 'CDC PLACES (obesity + diabetes prevalence, 2023)',
    component: 'quality_of_life',
  },
  crash_rate_pc: {
    label: 'Pedestrian/Cyclist Crash Rate',
    unit: 'crashes per 1,000 residents',
    source: 'MnDOT/MnDPS Vulnerable Road User Crash Data (2016–2021)',
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
  safety: 'Safety Index',
  opportunity: 'Opportunity Index',
  quality_of_life: 'Quality of Life Index',
  affordability: 'Affordability Index',
};

export const indexDescriptions: Record<string, string> = {
  safety: 'Comprised of: Crime Rate and Pedestrian/Cyclist Crash Rate. Higher crime or more crashes per capita lowers this index.',
  opportunity: 'Comprised of: Permit Rate and Unemployment Rate. More development raises this index; more unemployment lowers it.',
  quality_of_life: 'Comprised of: Service Requests, Housing Production, Traffic Volume, Chronic Disease Burden, and — where available — Trails, Transit Stops, Schools, Grocery Stores, and Healthcare Access. Service requests, traffic volume, and chronic disease burden lower the index; the rest raise it.',
  affordability: 'Comprised of: Census median home value, median gross rent, median household income, poverty rate, housing cost burden (% of income spent on rent), and homeownership rate. Lower home values/rent/poverty/cost-burden and higher income/homeownership (each relative to other districts) raise this index — see the Housing Affordability panel below for the raw figures.',
};

export const healthScoreMethodology =
  'Each index is built by normalizing its component metrics against all districts (z-score, then squashed to 0–100) and blending them by weight. The overall Health Score is a weighted average: 35% Safety + 25% Opportunity + 20% Quality of Life + 20% Affordability.';
