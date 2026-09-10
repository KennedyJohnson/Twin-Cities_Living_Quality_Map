'use client';

import { SCORE_METRIC_LABELS, ScoreMetricKey } from '@/lib/scoreMetric';

interface ScoreSelectorProps {
  value: ScoreMetricKey;
  onChange: (value: ScoreMetricKey) => void;
}

export default function ScoreSelector({ value, onChange }: ScoreSelectorProps) {
  return (
    <div className="score-selector">
      <label htmlFor="score-metric-select" style={{ fontSize: '12px', fontWeight: 600, color: '#666', display: 'block', marginBottom: '4px' }}>
        Color districts by
      </label>
      <select
        id="score-metric-select"
        value={value}
        onChange={(e) => onChange(e.target.value as ScoreMetricKey)}
        style={{
          fontSize: '13px',
          padding: '6px 8px',
          borderRadius: '6px',
          border: '1px solid #ccc',
          background: 'white',
          cursor: 'pointer',
        }}
      >
        {(Object.keys(SCORE_METRIC_LABELS) as ScoreMetricKey[]).map((key) => (
          <option key={key} value={key}>
            {SCORE_METRIC_LABELS[key]}
          </option>
        ))}
      </select>
    </div>
  );
}
