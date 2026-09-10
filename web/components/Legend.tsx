'use client';

import { getLegendColors } from '@/lib/ColorScale';
import { POINT_LAYER_COLORS, POINT_LAYER_LABELS } from '@/lib/pointLayerColors';

export default function Legend() {
  const colors = getLegendColors();

  return (
    <div className="legend">
      <div className="legend-title">Health Score</div>
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
                display: 'inline-block',
                width: '10px',
                height: '10px',
                borderRadius: '50%',
                backgroundColor: POINT_LAYER_COLORS[key],
              }}
            />
            <span>{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
