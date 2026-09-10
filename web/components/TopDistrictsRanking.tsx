'use client';

import { useEffect, useState } from 'react';
import { loadNeighborhoodData } from '@/lib/loadNeighborhoodData';
import { SCORE_METRIC_LABELS, ScoreMetricKey, getScoreValue } from '@/lib/scoreMetric';
import type { Neighborhood } from '@/types/neighborhood';

const SCORE_METRIC_KEYS = Object.keys(SCORE_METRIC_LABELS) as ScoreMetricKey[];

interface TopDistrictsRankingProps {
  onSelectDistrict?: (district: Neighborhood) => void;
}

export default function TopDistrictsRanking({ onSelectDistrict }: TopDistrictsRankingProps) {
  const [neighborhoods, setNeighborhoods] = useState<Neighborhood[]>([]);

  useEffect(() => {
    Promise.all([loadNeighborhoodData('stpaul'), loadNeighborhoodData('mpls')])
      .then(([stpaul, mpls]) => {
        setNeighborhoods([...stpaul.neighborhoods, ...mpls.neighborhoods]);
      })
      .catch(() => setNeighborhoods([]));
  }, []);

  if (neighborhoods.length === 0) return null;

  return (
    <div style={{ marginTop: '20px' }}>
      <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '10px', color: '#666' }}>
        Top Districts
      </div>
      {SCORE_METRIC_KEYS.map((metric) => {
        const top3 = [...neighborhoods]
          .filter((n) => getScoreValue(n, metric) != null)
          .sort((a, b) => getScoreValue(b, metric) - getScoreValue(a, metric))
          .slice(0, 3);

        if (top3.length === 0) return null;

        return (
          <div key={metric} style={{ marginBottom: '14px' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: '#756bb1', marginBottom: '6px' }}>
              {SCORE_METRIC_LABELS[metric]}
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
                  <span style={{ color: '#999' }}>({getScoreValue(n, metric).toFixed(1)})</span>
                </li>
              ))}
            </ol>
          </div>
        );
      })}
    </div>
  );
}
