'use client';

import { useEffect, useState } from 'react';
import { loadNeighborhoodData } from '@/lib/loadNeighborhoodData';
import { SCORE_METRIC_LABELS, ScoreMetricKey, MatchWeights, computeMatchScore, getScoreValue } from '@/lib/scoreMetric';
import type { Neighborhood } from '@/types/neighborhood';

const SCORE_METRIC_KEYS = Object.keys(SCORE_METRIC_LABELS) as ScoreMetricKey[];

interface TopDistrictsRankingProps {
  onSelectDistrict?: (district: Neighborhood) => void;
  granularity?: 'district' | 'zip';
  // When set, the overall row re-ranks by the visitor's weighted blend.
  personalWeights?: MatchWeights | null;
}

export default function TopDistrictsRanking({ onSelectDistrict, granularity = 'district', personalWeights = null }: TopDistrictsRankingProps) {
  const [neighborhoods, setNeighborhoods] = useState<Neighborhood[]>([]);
  const [zips, setZips] = useState<Neighborhood[]>([]);

  useEffect(() => {
    Promise.all([loadNeighborhoodData('stpaul'), loadNeighborhoodData('mpls')])
      .then(([stpaul, mpls]) => {
        setNeighborhoods([...stpaul.neighborhoods, ...mpls.neighborhoods]);
      })
      .catch(() => setNeighborhoods([]));

    loadNeighborhoodData('zip')
      .then((zip) => setZips(zip.neighborhoods))
      .catch(() => setZips([]));
  }, []);

  const isZip = granularity === 'zip';
  const pool = isZip ? zips : neighborhoods;

  if (pool.length === 0) return null;

  return (
    <div style={{ marginTop: '20px' }}>
      <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '10px', color: '#666' }}>
        {isZip ? 'Top ZIP Codes' : 'Top Districts'}
      </div>
      {SCORE_METRIC_KEYS.map((metric) => {
        const weighted = metric === 'health_score' && personalWeights != null;
        const scoreOf = (n: Neighborhood) =>
          weighted ? computeMatchScore(n, personalWeights) : getScoreValue(n, metric);
        const top3 = [...pool]
          .filter((n) => scoreOf(n) != null)
          .sort((a, b) => scoreOf(b) - scoreOf(a))
          .slice(0, 3);

        if (top3.length === 0) return null;

        return (
          <div key={metric} style={{ marginBottom: '14px' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--accent)', marginBottom: '6px' }}>
              {weighted ? 'Your Weighted Score' : SCORE_METRIC_LABELS[metric]}
            </div>
            <ol style={{ margin: 0, paddingLeft: '18px' }}>
              {top3.map((n) => (
                <li key={n.district_id} style={{ fontSize: '12px', marginBottom: '3px' }}>
                  <span
                    onClick={() => onSelectDistrict?.(n)}
                    style={{
                      color: onSelectDistrict ? '#756bb1' : undefined,
                      cursor: onSelectDistrict ? 'pointer' : undefined,
                      textDecoration: onSelectDistrict ? 'underline' : undefined,
                    }}
                  >
                    {n.district_name}
                  </span>{' '}
                  <span style={{ color: '#999' }}>({Math.round(scoreOf(n))})</span>
                </li>
              ))}
            </ol>
          </div>
        );
      })}
    </div>
  );
}
