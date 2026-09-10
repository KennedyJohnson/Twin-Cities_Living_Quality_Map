'use client';

import { useEffect, useState } from 'react';
import { getMetricLabel, getMetricUnit, indexLabels } from '@/lib/metricLabels';
import type { Neighborhood } from '@/types/neighborhood';

interface NeighborhoodSidebarProps {
  district: Neighborhood | null;
}

interface Affordability {
  median_home_value: number | null;
  median_gross_rent: number | null;
}

export default function NeighborhoodSidebar({ district }: NeighborhoodSidebarProps) {
  const [affordability, setAffordability] = useState<Record<string, Affordability>>({});

  useEffect(() => {
    Promise.all([
      fetch('/data/affordability_stpaul.json').then((r) => (r.ok ? r.json() : {})),
      fetch('/data/affordability_mpls.json').then((r) => (r.ok ? r.json() : {})),
    ])
      .then(([stpaul, mpls]) => setAffordability({ ...stpaul, ...mpls }))
      .catch(() => setAffordability({}));
  }, []);

  if (!district) {
    return (
      <div className="sidebar">
        <div className="no-selection">Click a district on the map to view details</div>
      </div>
    );
  }

  const districtAffordability = affordability[String(district.district_id)];

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

      {districtAffordability && (districtAffordability.median_home_value || districtAffordability.median_gross_rent) && (
        <div style={{ marginBottom: '20px' }}>
          <div style={{ fontSize: '13px', fontWeight: '600', marginBottom: '10px', color: '#666' }}>
            Housing Affordability
          </div>
          {districtAffordability.median_home_value != null && (
            <div className="metric-row">
              <span style={{ fontSize: '12px', color: '#999' }}>Median Home Value</span>
              <span className="metric-value">${districtAffordability.median_home_value.toLocaleString()}</span>
            </div>
          )}
          {districtAffordability.median_gross_rent != null && (
            <div className="metric-row">
              <span style={{ fontSize: '12px', color: '#999' }}>Median Gross Rent</span>
              <span className="metric-value">${districtAffordability.median_gross_rent.toLocaleString()}/mo</span>
            </div>
          )}
          <div style={{ fontSize: '11px', color: '#ccc', marginBottom: '12px' }}>
            Source: Census ACS 5-Year Estimates
          </div>
        </div>
      )}

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
