'use client';

import { useEffect, useState } from 'react';
import { getLegendColors } from '@/lib/ColorScale';
import { loadNeighborhoodData } from '@/lib/loadNeighborhoodData';
import { POINT_LAYER_COLORS, POINT_LAYER_LABELS, POINT_LAYER_ICONS, CANVAS_MARKER_THRESHOLD } from '@/lib/pointLayerColors';
import { getScoreValue, SCORE_METRIC_LABELS, ScoreMetricKey } from '@/lib/scoreMetric';

interface LegendProps {
  scoreMetric?: ScoreMetricKey;
  hiddenSources?: Set<string>;
  onToggleSource?: (key: string) => void;
  onDeselectAll?: (allKeys: string[]) => void;
}

const POINT_LAYER_FILES = ['/data/points_stpaul.json', '/data/points_mpls.json'];

export default function Legend({ scoreMetric = 'health_score', hiddenSources, onToggleSource, onDeselectAll }: LegendProps) {
  const [domain, setDomain] = useState<{ min: number; max: number }>({ min: 0, max: 100 });
  // Source -> feature count, so the swatch below can match how NeighborhoodMap
  // actually renders each source: a plain dot for a high-volume layer
  // (canvas circle markers), the emoji pin otherwise.
  const [sourceCounts, setSourceCounts] = useState<Record<string, number>>({});

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

  useEffect(() => {
    Promise.all(POINT_LAYER_FILES.map((url) => fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null)))
      .then((results) => {
        const counts: Record<string, number> = {};
        for (const geojson of results) {
          for (const feature of geojson?.features || []) {
            const source = feature.properties?.source || 'other';
            counts[source] = (counts[source] || 0) + 1;
          }
        }
        setSourceCounts(counts);
      });
  }, []);

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

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '10px' }}>
        <div className="legend-title" style={{ marginTop: 0 }}>Data Points</div>
        <button
          type="button"
          className="legend-deselect-all-button"
          onClick={() => onDeselectAll?.(Object.keys(POINT_LAYER_LABELS))}
        >
          Deselect all
        </button>
      </div>
      <div className="legend-points">
        {Object.entries(POINT_LAYER_LABELS).map(([key, label]) => {
          const isCanvasDot = (sourceCounts[key] || 0) > CANVAS_MARKER_THRESHOLD;
          const isHidden = hiddenSources?.has(key) ?? false;
          return (
            <label key={key} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={!isHidden}
                onChange={() => onToggleSource?.(key)}
              />
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: isCanvasDot ? '10px' : '16px',
                  height: isCanvasDot ? '10px' : '16px',
                  borderRadius: '50%',
                  backgroundColor: POINT_LAYER_COLORS[key],
                  border: isCanvasDot ? '1px solid #fff' : 'none',
                  boxShadow: isCanvasDot ? '0 0 0 1px rgba(0,0,0,0.2)' : 'none',
                  fontSize: '9px',
                  lineHeight: 1,
                  opacity: isHidden ? 0.4 : 1,
                }}
              >
                {isCanvasDot ? '' : POINT_LAYER_ICONS[key]}
              </span>
              <span style={{ opacity: isHidden ? 0.4 : 1 }}>{label}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
