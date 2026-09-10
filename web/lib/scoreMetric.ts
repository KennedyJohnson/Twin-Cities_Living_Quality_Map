import type { Neighborhood } from '@/types/neighborhood';

export type ScoreMetricKey = 'health_score' | 'safety' | 'opportunity' | 'quality_of_life' | 'affordability';

export const SCORE_METRIC_LABELS: Record<ScoreMetricKey, string> = {
  health_score: 'Overall Health Score',
  safety: 'Safety Index',
  opportunity: 'Opportunity Index',
  quality_of_life: 'Quality of Life Index',
  affordability: 'Affordability Index',
};

export function getScoreValue(neighborhood: Neighborhood, metric: ScoreMetricKey): number {
  if (metric === 'health_score') return neighborhood.health_score;
  return neighborhood.indices[metric] ?? 0;
}
