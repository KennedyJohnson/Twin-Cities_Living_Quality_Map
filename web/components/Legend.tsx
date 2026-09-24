'use client';

import { useEffect, useState } from 'react';
import { POINT_LAYER_COLORS, POINT_LAYER_LABELS } from '@/lib/pointLayerColors';
import { SCORE_METRIC_LABELS, ScoreMetricKey } from '@/lib/scoreMetric';
import { COLOR_METRICS, ColorMetricKey } from '@/lib/colorMetric';
import { supabase } from '@/lib/supabase';
import { LetterGrade, gradeColor, gradeTextColor } from '@/lib/letterGrade';

interface LegendProps {
  scoreMetric?: ScoreMetricKey;
  colorMetric?: ColorMetricKey | null;
  hiddenSources?: Set<string>;
  onToggleSource?: (key: string) => void;
  onDeselectAll?: (allKeys: string[]) => void;
  apartmentBuildingsVisible?: boolean;
  onToggleApartmentBuildings?: () => void;
  housesVisible?: boolean;
  onToggleHouses?: () => void;
  onHoverGrade?: (grade: LetterGrade | null) => void;
  pinnedGrade?: LetterGrade | null;
  onClickGrade?: (grade: LetterGrade) => void;
}

const POINT_LAYER_FILES = ['/data/points_stpaul.json', '/data/points_mpls.json'];

export default function Legend({
  scoreMetric = 'health_score',
  colorMetric = null,
  hiddenSources,
  onToggleSource,
  onDeselectAll,
  apartmentBuildingsVisible = false,
  housesVisible = false,
  onToggleHouses,
  onToggleApartmentBuildings,
  onHoverGrade,
  pinnedGrade = null,
  onClickGrade,
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
      <div className="legend-title">{colorMetric ? COLOR_METRICS[colorMetric].label : SCORE_METRIC_LABELS[scoreMetric]}</div>
      <div className="legend-scale">
        {grades.map((grade) => {
          const isPinned = pinnedGrade === grade;
          return (
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
                cursor: onHoverGrade || onClickGrade ? 'pointer' : undefined,
                boxShadow: isPinned ? '0 0 0 2px #333' : undefined,
                transform: isPinned ? 'scale(1.15)' : undefined,
                transition: 'transform 0.1s ease',
              }}
              title={`${grade} districts${onClickGrade ? ' (click to keep highlighted)' : ''}`}
              onMouseEnter={() => onHoverGrade?.(grade)}
              onMouseLeave={() => onHoverGrade?.(null)}
              onClick={() => onClickGrade?.(grade)}
            >
              {grade}
            </div>
          );
        })}
      </div>
      <div className="legend-labels">
        <span>{colorMetric ? (COLOR_METRICS[colorMetric].higherIsBetter ? 'Lowest' : 'Highest') : 'Poor'}</span>
        <span>{colorMetric ? (COLOR_METRICS[colorMetric].higherIsBetter ? 'Highest' : 'Lowest') : 'Excellent'}</span>
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
          const isHidden = hiddenSources?.has(key) ?? false;
          const isLine = key === 'trails';
          return (
            <label key={key} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={!isHidden}
                onChange={() => onToggleSource?.(key)}
                style={isLine ? { accentColor: POINT_LAYER_COLORS[key] } : undefined}
              />
              {isLine ? (
                <span
                  style={{
                    display: 'inline-block',
                    width: '16px',
                    height: '3px',
                    borderRadius: '2px',
                    backgroundColor: POINT_LAYER_COLORS[key],
                    opacity: isHidden ? 0.4 : 1,
                  }}
                />
              ) : (
                <span
                  style={{
                    display: 'inline-block',
                    width: '14px',
                    height: '14px',
                    borderRadius: '50%',
                    backgroundColor: POINT_LAYER_COLORS[key],
                    opacity: isHidden ? 0.4 : 1,
                  }}
                />
              )}
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
        {supabase && (
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', cursor: 'pointer', marginTop: '4px' }}>
            <input type="checkbox" checked={housesVisible} onChange={() => onToggleHouses?.()} />
            <span
              style={{
                display: 'inline-flex',
                flexShrink: 0,
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                backgroundColor: '#d9b48f',
                border: '1px solid #7a5c3e',
                opacity: housesVisible ? 1 : 0.4,
              }}
            />
            <span style={{ opacity: housesVisible ? 1 : 0.4 }}>
              Houses{housesVisible && <span style={{ color: '#999' }}> (visible when zoomed in)</span>}
            </span>
          </label>
        )}
      </div>
    </div>
  );
}
