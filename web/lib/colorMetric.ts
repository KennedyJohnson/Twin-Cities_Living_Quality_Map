// Raw-metric map coloring: lets the map be colored by a single underlying
// Census figure (from affordability_<city>.json / affordability_zip.json)
// instead of one of the 0-100 score components. Districts are still banded
// by percentile rank, so `higherIsBetter` controls which end reads as the
// "A" color; for neutral demographics (age, diversity, ...) we treat higher
// as darker/greener purely as a ranking direction, not a value judgment.

export type ColorMetricKey =
  | 'median_household_income'
  | 'median_home_value'
  | 'home_value_growth_pct'
  | 'median_gross_rent'
  | 'poverty_rate'
  | 'housing_cost_burden_rate'
  | 'homeownership_rate'
  | 'gini_index'
  | 'vacancy_rate'
  | 'bachelors_rate'
  | 'median_age'
  | 'diversity_index'
  | 'avg_commute_min'
  | 'transit_commute_rate'
  | 'walk_commute_rate'
  | 'bike_commute_rate'
  | 'wfh_rate';

export interface ColorMetricDef {
  label: string;
  higherIsBetter: boolean;
  format: (v: number) => string;
}

const pct = (v: number) => `${v.toFixed(1)}%`;
const usd = (v: number) => `$${Math.round(v).toLocaleString()}`;

export const COLOR_METRICS: Record<ColorMetricKey, ColorMetricDef> = {
  median_household_income: { label: 'Median Household Income', higherIsBetter: true, format: usd },
  median_home_value: { label: 'Median Home Value (higher = more expensive)', higherIsBetter: false, format: usd },
  // District-only (ZIPs have no value). Informational, not part of the score:
  // faster growth is neither good nor bad on its own (equity vs. affordability),
  // so "higher = darker" is a ranking direction only. See /home-value-model.
  home_value_growth_pct: {
    label: 'Home Value Growth since 2017 (faster = darker)',
    higherIsBetter: true,
    format: (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}%`,
  },
  median_gross_rent: { label: 'Median Gross Rent (higher = more expensive)', higherIsBetter: false, format: usd },
  poverty_rate: { label: 'Poverty Rate', higherIsBetter: false, format: pct },
  housing_cost_burden_rate: { label: 'Rent Cost Burden', higherIsBetter: false, format: pct },
  homeownership_rate: { label: 'Homeownership Rate', higherIsBetter: true, format: pct },
  gini_index: { label: 'Income Inequality (Gini)', higherIsBetter: false, format: (v) => v.toFixed(3) },
  vacancy_rate: { label: 'Housing Vacancy Rate', higherIsBetter: false, format: pct },
  bachelors_rate: { label: "Adults with Bachelor's+", higherIsBetter: true, format: pct },
  median_age: { label: 'Median Age (older = darker)', higherIsBetter: true, format: (v) => v.toFixed(1) },
  diversity_index: { label: 'Diversity Index (more diverse = darker)', higherIsBetter: true, format: (v) => v.toFixed(2) },
  avg_commute_min: { label: 'Average Commute Time', higherIsBetter: false, format: (v) => `${v.toFixed(1)} min` },
  transit_commute_rate: { label: 'Commute by Transit', higherIsBetter: true, format: pct },
  walk_commute_rate: { label: 'Commute on Foot', higherIsBetter: true, format: pct },
  bike_commute_rate: { label: 'Commute by Bike', higherIsBetter: true, format: pct },
  wfh_rate: { label: 'Work from Home', higherIsBetter: true, format: pct },
};

export type MetricRow = Partial<Record<ColorMetricKey, number | null>>;
export interface ColorMetricData {
  district: Record<string, MetricRow>;
  zip: Record<string, MetricRow>;
}

let cache: Promise<ColorMetricData> | null = null;

async function fetchDistricts(name: string): Promise<Record<string, MetricRow>> {
  try {
    const res = await fetch(`/data/affordability_${name}.json`);
    if (!res.ok) return {};
    const json = await res.json();
    return json.districts ?? {};
  } catch {
    return {};
  }
}

export function loadColorMetricData(): Promise<ColorMetricData> {
  if (!cache) {
    cache = Promise.all([
      fetchDistricts('stpaul'),
      fetchDistricts('mpls'),
      fetchDistricts('zip'),
    ]).then(([stpaul, mpls, zip]) => ({ district: { ...stpaul, ...mpls }, zip }));
  }
  return cache;
}

// Value used for percentile ranking: sign-flipped when lower is better so
// that "best" always ranks highest. Returns null when the metric is missing.
export function rankValue(
  data: ColorMetricData | null,
  kind: 'district' | 'zip',
  districtId: number,
  metric: ColorMetricKey
): number | null {
  const v = data?.[kind]?.[String(districtId)]?.[metric];
  if (v == null || Number.isNaN(v)) return null;
  return COLOR_METRICS[metric].higherIsBetter ? v : -v;
}

export function rawValue(
  data: ColorMetricData | null,
  kind: 'district' | 'zip',
  districtId: number,
  metric: ColorMetricKey
): number | null {
  const v = data?.[kind]?.[String(districtId)]?.[metric];
  return v == null || Number.isNaN(v) ? null : v;
}
