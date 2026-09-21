'use client';

import { SCORE_METRIC_LABELS, ScoreMetricKey } from '@/lib/scoreMetric';
import { COLOR_METRICS, ColorMetricKey } from '@/lib/colorMetric';

interface ScoreSelectorProps {
  value: ScoreMetricKey;
  onChange: (value: ScoreMetricKey) => void;
  colorMetric: ColorMetricKey | null;
  onColorMetricChange: (value: ColorMetricKey | null) => void;
}

export default function ScoreSelector({ value, onChange, colorMetric, onColorMetricChange }: ScoreSelectorProps) {
  return (
    <div className="score-selector">
      <label htmlFor="score-metric-select" style={{ fontSize: '12px', fontWeight: 600, color: '#666', display: 'block', marginBottom: '4px' }}>
        Color districts by
      </label>
      <select
        id="score-metric-select"
        value={colorMetric ? '' : value}
        onChange={(e) => {
          onColorMetricChange(null);
          onChange(e.target.value as ScoreMetricKey);
        }}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          textOverflow: 'ellipsis',
          fontSize: '13px',
          padding: '6px 8px',
          borderRadius: '6px',
          border: '1px solid #ccc',
          background: 'white',
          cursor: 'pointer',
        }}
      >
        {colorMetric && <option value="" disabled>(coloring by metric)</option>}
        {(Object.keys(SCORE_METRIC_LABELS) as ScoreMetricKey[]).map((key) => (
          <option key={key} value={key}>
            {SCORE_METRIC_LABELS[key]}
          </option>
        ))}
      </select>
      <label htmlFor="color-metric-select" style={{ fontSize: '12px', fontWeight: 600, color: '#666', display: 'block', margin: '8px 0 4px' }}>
        Or color by metric
      </label>
      <select
        id="color-metric-select"
        value={colorMetric ?? ''}
        onChange={(e) => onColorMetricChange((e.target.value || null) as ColorMetricKey | null)}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          textOverflow: 'ellipsis',
          fontSize: '13px',
          padding: '6px 8px',
          borderRadius: '6px',
          border: '1px solid #ccc',
          background: 'white',
          cursor: 'pointer',
        }}
      >
        <option value="">None (use score above)</option>
        {(Object.keys(COLOR_METRICS) as ColorMetricKey[]).map((key) => (
          <option key={key} value={key}>
            {COLOR_METRICS[key].label}
          </option>
        ))}
      </select>
    </div>
  );
}
