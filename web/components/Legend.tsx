'use client';

import { useEffect, useState } from 'react';
import { getLegendColors } from '@/lib/ColorScale';
import { loadNeighborhoodData } from '@/lib/loadNeighborhoodData';
import { POINT_LAYER_COLORS, POINT_LAYER_LABELS, POINT_LAYER_ICONS } from '@/lib/pointLayerColors';
import { getScoreValue, SCORE_METRIC_LABELS, ScoreMetricKey } from '@/lib/scoreMetric';

interface LegendProps {
  scoreMetric?: ScoreMetricKey;
}

export default function Legend({ scoreMetric = 'health_score' }: LegendProps) {
  const [domain, setDomain] = useState<{ min: number; max: number }>({ min: 0, max: 100 });

  useEffect(() => {
    Promise.all([
      loadNeighborhoodData('stpaul').catch(() => null),
      loadNeighborhoodData('mpls').catch(() => null),
    ]).then(([stpaul, mpls]) => {
      const neighborhoods = [...(stpaul?.neighborhoods || []), ...(mpls?.neighborhoods || [])];
      const scores = neighborhoods.map((n) => getScoreValue(n, scoreMetric));
      if (scores.length > 0) {
        setDomain({ min: Math.min(...scores), max: Math.max(...scores) });
      }
    });
  }, [scoreMetric]);

  const colors = getLegendColors(domain.min, domain.max);

  return (
    <div className="legend">
      <div className="legend-title">{SCORE_METRIC_LABELS[scoreMetric]}</div>
      <div className="legend-scale">
        {colors.map((item) => (
          <div
            key={item.value}
            className="legend-color"
            style={{ backgroundColor: item.color }}
            title={item.label}
          />
        ))}
      </div>
      <div className="legend-labels">
        <span>Poor</span>
        <span>Excellent</span>
      </div>

      <div className="legend-title" style={{ marginTop: '10px' }}>Data Points</div>
      <div className="legend-points">
        {Object.entries(POINT_LAYER_LABELS).map(([key, label]) => (
          <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '16px',
                height: '16px',
                borderRadius: '50%',
                backgroundColor: POINT_LAYER_COLORS[key],
                fontSize: '9px',
                lineHeight: 1,
              }}
            >
              {POINT_LAYER_ICONS[key]}
            </span>
            <span>{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
