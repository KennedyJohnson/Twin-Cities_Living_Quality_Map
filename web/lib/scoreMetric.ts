import type { Neighborhood } from '@/types/neighborhood';

export type ScoreMetricKey = 'health_score' | 'safety' | 'opportunity' | 'amenities' | 'affordability';

export const SCORE_METRIC_LABELS: Record<ScoreMetricKey, string> = {
  health_score: 'Overall Health Score',
  safety: 'Safety',
  opportunity: 'Opportunity',
  amenities: 'Amenities & Services',
  affordability: 'Affordability',
};

export function getScoreValue(neighborhood: Neighborhood, metric: ScoreMetricKey): number {
  if (metric === 'health_score') return neighborhood.health_score;
  return neighborhood.indices[metric] ?? 0;
}
