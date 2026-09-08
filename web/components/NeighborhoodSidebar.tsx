'use client';

import { getMetricLabel, getMetricUnit, indexLabels } from '@/lib/metricLabels';
import type { Neighborhood } from '@/types/neighborhood';

interface NeighborhoodSidebarProps {
  district: Neighborhood | null;
}

export default function NeighborhoodSidebar({ district }: NeighborhoodSidebarProps) {
  if (!district) {
    return (
      <div className="sidebar">
        <div className="no-selection">Click a district on the map to view details</div>
      </div>
    );
  }

  return (
    <div className="sidebar">
      <div className="district-title">{district.district_name}</div>
      <div className="district-subtitle">Population: {district.population.toLocaleString()}</div>

      <div className="health-score-display">{district.health_score.toFixed(1)}</div>

      <div style={{ marginBottom: '20px' }}>
        <div style={{ fontSize: '13px', fontWeight: '600', marginBottom: '10px', color: '#666' }}>
          Component Scores
        </div>
        <div className="index-grid">
          <div className="index-card">
            <div className="index-name">{indexLabels.safety}</div>
            <div className="index-score">{district.indices.safety.toFixed(1)}</div>
          </div>
          <div className="index-card">
            <div className="index-name">{indexLabels.opportunity}</div>
            <div className="index-score">{district.indices.opportunity.toFixed(1)}</div>
          </div>
          <div className="index-card">
            <div className="index-name">{indexLabels.quality_of_life}</div>
            <div className="index-score">{district.indices.quality_of_life.toFixed(1)}</div>
          </div>
        </div>
      </div>

      <div style={{ marginBottom: '20px' }}>
        <div style={{ fontSize: '13px', fontWeight: '600', marginBottom: '10px', color: '#666' }}>
          Metrics
        </div>
        {Object.entries(district.metrics).map(([metricKey, metric]) => (
          <div key={metricKey}>
            <div className="metric-label">{getMetricLabel(metricKey)}</div>
            <div className="metric-row">
              <span style={{ fontSize: '12px', color: '#999' }}>Count</span>
              <span className="metric-value">{metric.raw_count.toLocaleString()}</span>
            </div>
            <div className="metric-row">
              <span style={{ fontSize: '12px', color: '#999' }}>Rate</span>
              <span className="metric-value">{metric.rate_per_1000.toFixed(1)}</span>
            </div>
            <div style={{ fontSize: '11px', color: '#ccc', marginBottom: '12px' }}>
              {getMetricUnit(metricKey)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
