// inverted: true means a HIGHER raw rate is worse (crime, unemployment,
// etc.) — matches how these metrics are inverted before scoring in
// pipeline/core/health_score.py. Used to flip the "vs. all-district avg"
// diff color in NeighborhoodSidebar so a worse-than-average value always
// reads red, regardless of which direction "worse" points for that metric.
export const metricLabels: Record<string, { label: string; unit: string; source: string; component: string; trendKey?: string; inverted?: boolean }> = {
  crime_rate_pc: {
    label: 'Crime Rate',
    unit: 'incidents per 1,000 residents',
    source: 'City of St. Paul / Minneapolis Open Data: Crime Incident Reports',
    component: 'safety',
    trendKey: 'crime',
    inverted: true,
  },
  permit_rate_pc: {
    label: 'Permit Rate',
    unit: 'permits per 1,000 residents',
    source: 'City of St. Paul / Minneapolis Open Data: Approved Building Permits',
    component: 'opportunity',
    trendKey: 'permits',
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
    inverted: true,
  },
  unemployment_rate_pc: {
    label: 'Unemployment Rate',
    unit: 'unemployed residents per 1,000 residents',
    source: 'U.S. Census Bureau ACS 5-Year Estimates',
    component: 'opportunity',
    inverted: true,
  },
  housing_inventory_pc: {
    label: 'Housing Market Tightness',
    unit: 'for-sale listings per 1,000 residents',
    source: 'Zillow Research: For-Sale Inventory (monthly)',
    component: 'opportunity',
    // More listings relative to population means a LOOSER (less in-demand)
    // market, which reads as lower Opportunity — see weights.json.
    inverted: true,
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
  entertainment_pc: {
    label: 'Entertainment Venue Access Rate',
    unit: 'venues per 1,000 residents',
    source: 'OpenStreetMap (via Overpass API, live/current data)',
    component: 'amenities',
  },
  chronic_disease_pc: {
    label: 'Chronic Disease Burden',
    unit: 'affected residents per 1,000 residents',
    source: 'CDC PLACES (obesity + diabetes prevalence, 2023)',
    component: 'safety',
    inverted: true,
  },
  crash_rate_pc: {
    label: 'Pedestrian/Cyclist Crash Rate',
    unit: 'crashes per 1,000 residents',
    source: 'MnDOT/MnDPS Vulnerable Road User Crash Data (2016–2021)',
    component: 'safety',
    inverted: true,
  },
  disaster_risk_pc: {
    label: 'Natural Hazard Risk',
    unit: 'risk-weighted residents per 1,000 pop',
    source: 'FEMA National Risk Index (18 natural hazards, composite score by census tract)',
    component: 'safety',
    inverted: true,
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

export function isMetricInverted(metricName: string): boolean {
  return metricLabels[metricName]?.inverted ?? false;
}

export function getMetricsForComponent(componentKey: string): string[] {
  return Object.entries(metricLabels)
    .filter(([, v]) => v.component === componentKey)
    .map(([k]) => k);
}

export const indexLabels: Record<string, string> = {
  safety: 'Safety & Health',
  opportunity: 'Opportunity',
  amenities: 'Amenities & Services',
  transportation: 'Transportation',
  affordability: 'Economic Profile',
  walkability_score: 'Walk/Bike Score',
  broadband_score: 'Broadband Access',
  commute_score: 'Commute Quality',
  education_score: 'Educational Attainment',
};

export const indexDescriptions: Record<string, string> = {
  safety: 'Comprised of: Crime Rate, Pedestrian/Cyclist Crash Rate, Natural Hazard Risk, and Chronic Disease Burden.',
  opportunity: 'Comprised of: Permit Rate and Unemployment Rate. More development raises this index; more unemployment lowers it.',
  amenities: 'Comprised of: Schools, Grocery Stores, Restaurants/Bars, Healthcare Access, and Entertainment Venues where available, blended 85/15 with Broadband Access below.',
  transportation: 'Comprised of: Trail/Path Length and Transit Stop Rate (direct) minus Traffic Volume (inverted), blended 25% with the Walk/Bike Score and 15% with the Commute Quality score below.',
  affordability: 'Comprised of: Census median home value, median gross rent, median household income, poverty rate, housing cost burden (% of income spent on rent), homeownership rate, income inequality (Gini index), and housing vacancy rate (lower = better).',
  walkability_score: 'A Zillow-style Walk/Bike Score: distance-decay proximity to groceries, restaurants/bars, transit, schools, and healthcare, plus street-intersection density (a block-size/bikeability proxy) and trail km per capita. Closer amenities, denser intersections, and more trails raise this score. Feeds 25% of the Transportation index.',
  education_score: "Share of adults 25+ with a bachelor's degree or higher (Census ACS), relative to other districts. Feeds 15% of the Opportunity index.",
  commute_score: 'Census ACS commute quality: shorter average commute time (excluding remote workers) and a higher share of workers commuting by transit, walking, or bike raise this score, relative to other districts. Feeds 15% of the Transportation index.',
  broadband_score: 'Share of households with an internet subscription (Census ACS), relative to other districts. Feeds 15% of the Amenities & Services index.',
};
