'use client';

import { getLegendColors } from '@/lib/ColorScale';

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
    </div>
  );
}
