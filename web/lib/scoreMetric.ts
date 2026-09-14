import type { Neighborhood } from '@/types/neighborhood';

export type ScoreMetricKey = 'health_score' | 'safety' | 'opportunity' | 'amenities' | 'transportation' | 'affordability';

export const SCORE_METRIC_LABELS: Record<ScoreMetricKey, string> = {
  health_score: 'Overall Living Quality Score',
  safety: 'Safety & Health',
  opportunity: 'Opportunity',
  amenities: 'Amenities & Services',
  transportation: 'Transportation',
  affordability: 'Affordability',
};

export function getScoreValue(neighborhood: Neighborhood, metric: ScoreMetricKey): number {
  if (metric === 'health_score') return neighborhood.health_score;
  return neighborhood.indices[metric] ?? 0;
}

// The 5 components a "Find Your Match" weight slider can apply to. Importance
// values are 0-100; components a district has no data for are simply left
// out of that district's weighted average rather than counted as 0.
export type MatchComponent = 'safety' | 'opportunity' | 'amenities' | 'transportation' | 'affordability';

export type MatchWeights = Record<MatchComponent, number>;

export const DEFAULT_MATCH_WEIGHTS: MatchWeights = {
  safety: 50,
  opportunity: 50,
  amenities: 50,
  transportation: 50,
  affordability: 50,
};

// True once at least one component actually contributes to the weighted
// score. All-zero weights makes computeMatchScore degenerate to 0 for every
// district — callers should check this first and show a message instead of
// a flat, meaningless ranking/coloring.
export function hasActiveWeights(weights: MatchWeights): boolean {
  return Object.values(weights).some((w) => w > 0);
}

export function computeMatchScore(neighborhood: Neighborhood, weights: MatchWeights): number {
  let weightedSum = 0;
  let weightTotal = 0;
  for (const component of Object.keys(weights) as MatchComponent[]) {
    const value = neighborhood.indices[component];
    const weight = weights[component];
    if (value === undefined || weight <= 0) continue;
    weightedSum += value * weight;
    weightTotal += weight;
  }
  return weightTotal > 0 ? weightedSum / weightTotal : 0;
}

// Single entry point used by the map so it doesn't need to know whether the
// user is coloring by a fixed metric or their own custom weighting.
export function resolveScore(
  neighborhood: Neighborhood,
  metric: ScoreMetricKey,
  matchWeights: MatchWeights | null
): number {
  if (matchWeights) return computeMatchScore(neighborhood, matchWeights);
  return getScoreValue(neighborhood, metric);
}
