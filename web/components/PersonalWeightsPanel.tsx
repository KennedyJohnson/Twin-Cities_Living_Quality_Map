'use client';

import { useState } from 'react';
import { SCORE_METRIC_LABELS, MatchWeights } from '@/lib/scoreMetric';
import {
  DEFAULT_PERSONAL_WEIGHTS,
  PERSONAL_COMPONENT_ORDER,
  PERSONAL_WEIGHT_MAX,
  PERSONAL_WEIGHT_MIN,
} from '@/lib/personalWeights';

interface PersonalWeightsPanelProps {
  weights: MatchWeights;
  onChange: (weights: MatchWeights) => void;
  // Whether the custom blend is currently coloring the map and ranking.
  active: boolean;
  // Why the blend is not applied when it is not: a single metric is selected
  // in "Color districts by", or every weight is zero.
  inactiveReason: 'metric' | 'zero' | null;
}

export default function PersonalWeightsPanel({ weights, onChange, active, inactiveReason }: PersonalWeightsPanelProps) {
  const [open, setOpen] = useState(false);
  const isDefault = PERSONAL_COMPONENT_ORDER.every((c) => weights[c] === DEFAULT_PERSONAL_WEIGHTS[c]);

  return (
    <div className="match-finder-section" style={{ marginTop: '10px' }}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{
          width: '100%',
          textAlign: 'left',
          fontSize: '12px',
          fontWeight: 600,
          color: '#666',
          padding: '6px 8px',
          borderRadius: '6px',
          border: '1px solid #ccc',
          background: 'white',
          cursor: 'pointer',
        }}
      >
        {open ? 'Hide' : 'Show'} personal weights{active ? ' (on)' : ''}
      </button>

      {open && (
        <div style={{ marginTop: '8px' }}>
          <div style={{ fontSize: '11.5px', color: '#666', marginBottom: '8px' }}>
            Set how much each part of the Overall score matters to you. The map and rankings update live.
          </div>
          {inactiveReason && (
            <div style={{ fontSize: '11.5px', color: '#b45309', marginBottom: '8px' }}>
              {inactiveReason === 'metric'
                ? 'Weights apply when "Color districts by" is set to the Overall Living Quality Score.'
                : 'Set at least one weight above 0 to apply your weights.'}
            </div>
          )}
          {PERSONAL_COMPONENT_ORDER.map((component) => {
            const id = `personal-weight-${component}`;
            return (
              <div key={component} className="match-finder-slider-row">
                <div className="match-finder-slider-row-header">
                  <label htmlFor={id}>{SCORE_METRIC_LABELS[component]}</label>
                  <span className="match-finder-slider-value">{weights[component]}</span>
                </div>
                <input
                  id={id}
                  type="range"
                  aria-label={`${SCORE_METRIC_LABELS[component]} weight`}
                  min={PERSONAL_WEIGHT_MIN}
                  max={PERSONAL_WEIGHT_MAX}
                  step={1}
                  value={weights[component]}
                  onChange={(e) => onChange({ ...weights, [component]: Number(e.target.value) })}
                  className="match-finder-importance-slider"
                />
              </div>
            );
          })}
          <button
            type="button"
            className="match-finder-reset"
            disabled={isDefault}
            onClick={() => onChange({ ...DEFAULT_PERSONAL_WEIGHTS })}
          >
            Reset to equal weights
          </button>
        </div>
      )}
    </div>
  );
}
