'use client';

import { useEffect, useState } from 'react';
import { POINT_LAYER_COLORS, POINT_LAYER_LABELS, POINT_LAYER_ICONS, CANVAS_MARKER_THRESHOLD } from '@/lib/pointLayerColors';
import { SCORE_METRIC_LABELS, ScoreMetricKey } from '@/lib/scoreMetric';
import { LetterGrade, gradeColor, gradeTextColor } from '@/lib/letterGrade';

interface LegendProps {
  scoreMetric?: ScoreMetricKey;
  hiddenSources?: Set<string>;
  onToggleSource?: (key: string) => void;
  onDeselectAll?: (allKeys: string[]) => void;
  apartmentBuildingsVisible?: boolean;
  onToggleApartmentBuildings?: () => void;
}

const POINT_LAYER_FILES = ['/data/points_stpaul.json', '/data/points_mpls.json'];

export default function Legend({
  scoreMetric = 'health_score',
  hiddenSources,
  onToggleSource,
  onDeselectAll,
  apartmentBuildingsVisible = false,
  onToggleApartmentBuildings,
}: LegendProps) {
  // Source -> feature count, so the swatch below can match how NeighborhoodMap
  // actually renders each source: a plain dot for a high-volume layer
  // (canvas circle markers), the emoji pin otherwise.
  const [sourceCounts, setSourceCounts] = useState<Record<string, number>>({});

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

  // Map fills are colored by discrete letter-grade band (same as the grade
  // badges), not a continuous gradient — a continuous scale bunched A and B
  // districts into near-identical dark shades since both sit at the high end
  // of the percentile range. See letterGrade.ts / NeighborhoodMap.tsx.
  const grades: LetterGrade[] = ['F', 'D', 'C', 'B', 'A'];

  return (
    <div className="legend">
      <div className="legend-title">{SCORE_METRIC_LABELS[scoreMetric]}</div>
      <div className="legend-scale">
        {grades.map((grade) => (
          <div
            key={grade}
            className="legend-color"
            style={{
              backgroundColor: gradeColor(grade),
              color: gradeTextColor(grade),
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '10px',
              fontWeight: 600,
            }}
            title={grade}
          >
            {grade}
          </div>
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

      <div className="legend-points" style={{ marginTop: '10px' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={apartmentBuildingsVisible}
            onChange={() => onToggleApartmentBuildings?.()}
          />
          <span
            style={{
              display: 'inline-flex',
              flexShrink: 0,
              width: '10px',
              height: '10px',
              borderRadius: '50%',
              backgroundColor: '#fff',
              border: '2px solid #333',
              boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
              opacity: apartmentBuildingsVisible ? 1 : 0.4,
            }}
          />
          <span style={{ opacity: apartmentBuildingsVisible ? 1 : 0.4 }}>
            Apartment Buildings
          </span>
        </label>
      </div>
    </div>
  );
}
