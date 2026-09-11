import L from 'leaflet';
import type { Neighborhood, Metric } from '@/types/neighborhood';

export const RADIUS_METERS = 1609.34;
const RADIUS_MILES = 1;
const CIRCLE_AREA_SQMI = Math.PI * RADIUS_MILES * RADIUS_MILES;

export interface RadiusBaselineSource {
  id: string;
  metric_name: string;
  weight_in_component: number;
  rate_direction: 'direct' | 'invert';
  geometry_type: 'point' | 'line';
}

export interface RadiusBaselineComponent {
  mean: number;
  std: number;
  sources: RadiusBaselineSource[];
}

export interface RadiusBaselineAffordabilityField {
  mean: number;
  std: number;
  direction: 'direct' | 'invert';
}

export interface RadiusBaseline {
  // Keyed by whatever health-score components sources.json defines (safety,
  // opportunity, amenities, transportation, ...) — not a fixed list,
  // so a newly added component shows up automatically once the pipeline
  // export recognizes it, with no frontend code change needed.
  components: Record<string, RadiusBaselineComponent>;
  affordability_fields: Record<string, RadiusBaselineAffordabilityField>;
  health_score_weights: Record<string, number>;
}

export interface TractAffordabilityRow {
  tract_id: string;
  lat: number;
  lon: number;
  population: number | null;
  median_home_value: number | null;
  median_gross_rent: number | null;
  median_household_income: number | null;
  poverty_rate: number | null;
  housing_cost_burden_rate: number | null;
  homeownership_rate: number | null;
}

export interface TractsAffordabilityFile {
  acs_year: number;
  tracts: TractAffordabilityRow[];
}

export interface PointEntry {
  source: string;
  latlng: L.LatLng;
}

export interface TrailEntry {
  source: string;
  latlngs: L.LatLng[];
}

// The map layer tags trail features "trails" (for icons/labels), while
// sources.json's health-score id for the same data is "walkability" — the
// one known naming mismatch, mirrored from SOURCE_ID_ALIASES in
// pipeline/exports/export_radius_baseline.py. Extend both sides together if
// a future line-geometry source has a similar mismatch.
const SOURCE_ID_ALIASES: Record<string, string> = { trails: 'walkability' };

function logisticNormalize(value: number, mean: number, std: number): number {
  if (!std || std === 0) return 50;
  const z = (value - mean) / std;
  return 100 / (1 + Math.exp(-z));
}

function computeComponentIndex(
  center: L.LatLng,
  component: RadiusBaselineComponent,
  points: PointEntry[],
  trails: TrailEntry[]
): { value: number | null; metrics: Record<string, Metric> } {
  const metrics: Record<string, Metric> = {};
  let weightedSum = 0;
  let weightSum = 0;

  for (const source of component.sources) {
    let rawCount = 0;
    if (source.geometry_type === 'line') {
      for (const trail of trails) {
        if ((SOURCE_ID_ALIASES[trail.source] ?? trail.source) !== source.id) continue;
        for (let i = 0; i < trail.latlngs.length - 1; i++) {
          const a = trail.latlngs[i];
          const b = trail.latlngs[i + 1];
          if (a.distanceTo(center) <= RADIUS_METERS && b.distanceTo(center) <= RADIUS_METERS) {
            rawCount += a.distanceTo(b) / 1000; // km
          }
        }
      }
    } else {
      for (const point of points) {
        if (point.source === source.id && point.latlng.distanceTo(center) <= RADIUS_METERS) {
          rawCount += 1;
        }
      }
    }

    const perSqMi = rawCount / CIRCLE_AREA_SQMI;
    const signedRate = source.rate_direction === 'invert' ? -perSqMi : perSqMi;
    const normalized = logisticNormalize(signedRate, component.mean, component.std);

    weightedSum += normalized * source.weight_in_component;
    weightSum += source.weight_in_component;

    metrics[source.metric_name] = {
      raw_count: Math.round(rawCount * 100) / 100,
      rate_per_1000: Math.round(perSqMi * 100) / 100,
    };
  }

  if (weightSum === 0) return { value: null, metrics };
  return { value: weightedSum / weightSum, metrics };
}

function computeAffordability(
  center: L.LatLng,
  fields: Record<string, RadiusBaselineAffordabilityField>,
  tracts: TractAffordabilityRow[]
): number | null {
  const nearby = tracts.filter((t) => L.latLng(t.lat, t.lon).distanceTo(center) <= RADIUS_METERS);
  if (nearby.length === 0) return null;

  const parts: number[] = [];
  for (const [field, baseline] of Object.entries(fields)) {
    const valid = nearby.filter(
      (t) => (t as any)[field] != null && t.population != null && t.population > 0
    );
    if (valid.length === 0) continue;
    const totalPop = valid.reduce((s, t) => s + (t.population || 0), 0);
    if (totalPop === 0) continue;
    const weightedValue = valid.reduce((s, t) => s + (t as any)[field] * (t.population || 0), 0) / totalPop;
    const normalized = logisticNormalize(weightedValue, baseline.mean, baseline.std);
    parts.push(baseline.direction === 'invert' ? 100 - normalized : normalized);
  }

  if (parts.length === 0) return null;
  return parts.reduce((a, b) => a + b, 0) / parts.length;
}

export function computeRadiusNeighborhood(params: {
  lat: number;
  lon: number;
  label: string;
  baseline: RadiusBaseline;
  points: PointEntry[];
  trails: TrailEntry[];
  tracts: TractAffordabilityRow[];
  containingDistrictId?: number | null;
}): Neighborhood {
  const { lat, lon, label, baseline, points, trails, tracts, containingDistrictId } = params;
  const center = L.latLng(lat, lon);

  const allMetrics: Record<string, Metric> = {};
  const componentValues: Record<string, number | null> = {};

  // Iterates whatever components the baseline file actually contains
  // (safety, opportunity, amenities, transportation, ...) rather than
  // a fixed list, so a newly added component is scored automatically.
  for (const key of Object.keys(baseline.components)) {
    const { value, metrics } = computeComponentIndex(center, baseline.components[key], points, trails);
    componentValues[key] = value;
    Object.assign(allMetrics, metrics);
  }

  const affordability = computeAffordability(center, baseline.affordability_fields, tracts);

  const weights = baseline.health_score_weights;

  // Any component with zero client-available sources (e.g. Opportunity has
  // none today — permits/unemployment aren't shipped to the browser) is
  // excluded rather than defaulted to 0, and its weight is redistributed
  // across whichever components ARE available — same fallback pattern
  // health_score.py already uses when Affordability alone is missing.
  const weighted: { value: number; weight: number }[] = [];
  for (const [key, value] of Object.entries(componentValues)) {
    if (value != null && weights[key] != null) {
      weighted.push({ value, weight: weights[key] });
    }
  }
  if (affordability != null && weights.affordability != null) {
    weighted.push({ value: affordability, weight: weights.affordability });
  }

  const totalWeight = weighted.reduce((s, w) => s + w.weight, 0);
  const healthScore = totalWeight > 0
    ? weighted.reduce((s, w) => s + w.value * w.weight, 0) / totalWeight
    : 0;

  const nearbyTracts = tracts.filter((t) => L.latLng(t.lat, t.lon).distanceTo(center) <= RADIUS_METERS);
  const population = nearbyTracts.reduce((s, t) => s + (t.population || 0), 0);

  const round2 = (n: number) => Math.round(n * 100) / 100;
  const indices: Neighborhood['indices'] = {};
  for (const [key, value] of Object.entries(componentValues)) {
    if (value != null) (indices as Record<string, number>)[key] = round2(value);
  }
  if (affordability != null) indices.affordability = round2(affordability);

  return {
    district_id: -1,
    district_name: label,
    population,
    metrics: allMetrics,
    indices,
    health_score: Math.round(healthScore * 100) / 100,
    is_radius: true,
    containing_district_id: containingDistrictId ?? undefined,
  };
}
