// "Biggest movers" over time for the Trends page: which districts changed
// the most, year-over-year, on the handful of metrics that actually HAVE
// multi-year history (crime, permits, and the Census affordability fields).
// Most of the Living Quality Score's inputs (schools, groceries, transit,
// chronic disease, crash rate, etc.) are single-snapshot-only — there's no
// historical archive to build an "Overall Score over time" ranking from —
// so this deliberately stays scoped to metrics with real year-by-year data
// instead of reconstructing a misleading synthetic score history.

export interface DistrictMover {
  districtId: number;
  districtName: string;
  city: 'stpaul' | 'mpls';
  firstYear: number;
  lastYear: number;
  firstValue: number;
  lastValue: number;
  pctChange: number;
}

export interface MoverMetricConfig {
  key: string;
  label: string;
  unit: string;
  inverted: boolean; // true = a decrease is the "improvement" direction
  isRate: boolean; // true = raw count needs /population*1000; false = already a rate/value (affordability fields)
  format: (v: number) => string;
}

export const MOVER_METRICS: MoverMetricConfig[] = [
  { key: 'crime', label: 'Crime Rate', unit: 'per 1,000 residents', inverted: true, isRate: true, format: (v) => v.toFixed(1) },
  { key: 'permits', label: 'Building Permit Rate', unit: 'per 1,000 residents', inverted: false, isRate: true, format: (v) => v.toFixed(1) },
  { key: 'median_home_value', label: 'Median Home Value', unit: '', inverted: true, isRate: false, format: (v) => `$${Math.round(v).toLocaleString()}` },
  { key: 'median_gross_rent', label: 'Median Gross Rent', unit: '/mo', inverted: true, isRate: false, format: (v) => `$${Math.round(v).toLocaleString()}` },
  { key: 'median_household_income', label: 'Median Household Income', unit: '', inverted: false, isRate: false, format: (v) => `$${Math.round(v).toLocaleString()}` },
  { key: 'poverty_rate', label: 'Poverty Rate', unit: '%', inverted: true, isRate: false, format: (v) => `${v.toFixed(1)}%` },
  { key: 'housing_cost_burden_rate', label: 'Housing Cost Burden (renters)', unit: '%', inverted: true, isRate: false, format: (v) => `${v.toFixed(1)}%` },
  { key: 'homeownership_rate', label: 'Homeownership Rate', unit: '%', inverted: false, isRate: false, format: (v) => `${v.toFixed(1)}%` },
];

interface TimeseriesFile {
  districts: Record<string, { years: number[]; crime?: number[]; permits?: number[] }>;
}

interface AffordabilityTimeseriesFile {
  years: number[];
  districts: Record<string, Record<string, (number | null)[]>>;
}

interface NeighborhoodLite {
  district_id: number;
  district_name: string;
  population: number;
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url);
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

// Computes the first-to-last-year % change per district for one metric,
// across both cities, sorted so callers can slice the extremes off either
// end (most improved / most worsened).
export async function computeMovers(metricKey: string): Promise<DistrictMover[]> {
  const config = MOVER_METRICS.find((m) => m.key === metricKey);
  if (!config) return [];

  const movers: DistrictMover[] = [];

  for (const city of ['stpaul', 'mpls'] as const) {
    const neighborhoodsFile = city === 'mpls' ? 'neighborhoods_mpls.json' : 'neighborhoods.json';
    const neighborhoods = await fetchJson<{ neighborhoods: NeighborhoodLite[] }>(`/data/${neighborhoodsFile}`);
    const nameById = new Map<number, string>();
    const popById = new Map<number, number>();
    for (const n of neighborhoods?.neighborhoods ?? []) {
      nameById.set(n.district_id, n.district_name);
      popById.set(n.district_id, n.population);
    }

    if (config.isRate) {
      const ts = await fetchJson<TimeseriesFile>(`/data/timeseries_${city}.json`);
      if (!ts) continue;
      for (const [idStr, series] of Object.entries(ts.districts)) {
        const districtId = Number(idStr);
        const population = popById.get(districtId);
        const rawValues = series[config.key as 'crime' | 'permits'];
        if (!population || !rawValues) continue;
        const pairs = series.years
          .map((year, i) => ({ year, value: rawValues[i] }))
          .filter((p): p is { year: number; value: number } => p.value != null);
        if (pairs.length < 2) continue;
        const first = pairs[0];
        const last = pairs[pairs.length - 1];
        const firstRate = (first.value / population) * 1000;
        const lastRate = (last.value / population) * 1000;
        if (firstRate === 0) continue;
        movers.push({
          districtId,
          districtName: nameById.get(districtId) ?? `District ${districtId}`,
          city,
          firstYear: first.year,
          lastYear: last.year,
          firstValue: firstRate,
          lastValue: lastRate,
          pctChange: ((lastRate - firstRate) / firstRate) * 100,
        });
      }
    } else {
      const ts = await fetchJson<AffordabilityTimeseriesFile>(`/data/affordability_timeseries_${city}.json`);
      if (!ts) continue;
      for (const [idStr, series] of Object.entries(ts.districts)) {
        const districtId = Number(idStr);
        const values = series[config.key];
        if (!values) continue;
        const pairs = ts.years
          .map((year, i) => ({ year, value: values[i] }))
          .filter((p): p is { year: number; value: number } => p.value != null);
        if (pairs.length < 2) continue;
        const first = pairs[0];
        const last = pairs[pairs.length - 1];
        if (first.value === 0) continue;
        movers.push({
          districtId,
          districtName: nameById.get(districtId) ?? `District ${districtId}`,
          city,
          firstYear: first.year,
          lastYear: last.year,
          firstValue: first.value,
          lastValue: last.value,
          pctChange: ((last.value - first.value) / first.value) * 100,
        });
      }
    }
  }

  return movers.sort((a, b) => b.pctChange - a.pctChange);
}
