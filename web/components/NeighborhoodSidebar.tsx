'use client';

import { useEffect, useState } from 'react';
import {
  getMetricLabel,
  getMetricUnit,
  getMetricSource,
  getMetricsForComponent,
  getMetricTrendKey,
  indexLabels,
  indexDescriptions,
  healthScoreMethodology,
} from '@/lib/metricLabels';
import MetricTrendChart from './MetricTrendChart';
import AffordabilityTrendChart from './AffordabilityTrendChart';
import IndexComparisonChart from './IndexComparisonChart';
import TopDistrictsRanking from './TopDistrictsRanking';
import type { Neighborhood } from '@/types/neighborhood';

interface NeighborhoodSidebarProps {
  district: Neighborhood | null;
  onSelectDistrict?: (district: Neighborhood) => void;
}

interface Affordability {
  median_home_value: number | null;
  median_gross_rent: number | null;
  median_household_income: number | null;
  poverty_rate: number | null;
  housing_cost_burden_rate: number | null;
  homeownership_rate: number | null;
}

interface AffordabilityFile {
  acs_year: number;
  districts: Record<string, Affordability>;
}

export default function NeighborhoodSidebar({ district, onSelectDistrict }: NeighborhoodSidebarProps) {
  const [affordability, setAffordability] = useState<Record<string, Affordability>>({});
  const [acsYear, setAcsYear] = useState<number | null>(null);
  const [expandedIndex, setExpandedIndex] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch('/data/affordability_stpaul.json').then((r) => (r.ok ? r.json() : null)) as Promise<AffordabilityFile | null>,
      fetch('/data/affordability_mpls.json').then((r) => (r.ok ? r.json() : null)) as Promise<AffordabilityFile | null>,
    ])
      .then(([stpaul, mpls]) => {
        setAffordability({ ...(stpaul?.districts || {}), ...(mpls?.districts || {}) });
        setAcsYear(stpaul?.acs_year ?? mpls?.acs_year ?? null);
      })
      .catch(() => setAffordability({}));
  }, []);

  if (!district) {
    return (
      <div className="sidebar">
        <div className="no-selection">Click a district on the map to view details</div>
        <TopDistrictsRanking onSelectDistrict={onSelectDistrict} />
      </div>
    );
  }

  const districtAffordability = affordability[String(district.district_id)];

  return (
    <div className="sidebar">
      <div className="district-title">{district.district_name}</div>
      <div className="district-subtitle">
        {district.is_radius
          ? `1-mile radius${district.population > 0 ? ` • ~${district.population.toLocaleString()} residents nearby` : ''}`
          : `Population: ${district.population.toLocaleString()}`}
      </div>

      <div className="health-score-display">{district.health_score.toFixed(1)}</div>
      <div style={{ fontSize: '11px', color: '#999', marginTop: '-8px', marginBottom: '16px', lineHeight: 1.4 }}>
        {district.is_radius
          ? 'Estimated from OpenStreetMap + Census data within 1 mile, using per-area rates (not per-capita, since population isn’t known for an arbitrary point). Only includes metrics with location data precise enough to check against an arbitrary point — a metric only available at the district level is left out here and its weight redistributed, so a component with no eligible metrics may be missing entirely. Walk/Bike Score’s distance-decay blend into Transportation isn’t replicated either. District scores use the full metric set.'
          : healthScoreMethodology}
      </div>

      <IndexComparisonChart district={district} />

      <div style={{ marginBottom: '20px' }}>
        <div style={{ fontSize: '13px', fontWeight: '600', marginBottom: '10px', color: '#666' }}>
          Component Scores <span style={{ fontWeight: 400, color: '#999' }}>(click to see what's included)</span>
        </div>
        <div className="index-grid">
          {(['safety', 'opportunity', 'quality_of_life', 'transportation', 'affordability', 'walkability_score'] as const)
            .filter((key) => district.indices[key] != null)
            .map((key) => (
              <div
                key={key}
                className="index-card"
                onClick={() => setExpandedIndex(expandedIndex === key ? null : key)}
                style={{ cursor: 'pointer', border: expandedIndex === key ? '2px solid #756bb1' : undefined }}
              >
                <div className="index-name">{indexLabels[key]}</div>
                <div className="index-score">{district.indices[key]!.toFixed(1)}</div>
              </div>
            ))}
        </div>

        {expandedIndex && (
          <div style={{ marginTop: '12px', padding: '10px', background: '#f7f7f9', borderRadius: '6px' }}>
            <div style={{ fontSize: '12px', color: '#555', marginBottom: '10px', lineHeight: 1.4 }}>
              {indexDescriptions[expandedIndex]}
            </div>
            {expandedIndex === 'affordability' ? (
              district.is_radius ? (
                <div style={{ fontSize: '12px', color: '#999' }}>
                  Estimated from Census tracts within 1 mile; a field-by-field breakdown is only available for full districts.
                </div>
              ) : districtAffordability ? (
                <div>
                  {([
                    ['median_home_value', 'Median Home Value', (v: number) => `$${v.toLocaleString()}`],
                    ['median_gross_rent', 'Median Gross Rent', (v: number) => `$${v.toLocaleString()}/mo`],
                    ['median_household_income', 'Median Household Income', (v: number) => `$${v.toLocaleString()}`],
                    ['poverty_rate', 'Poverty Rate', (v: number) => `${v}%`],
                    ['housing_cost_burden_rate', 'Housing Cost Burden (renters)', (v: number) => `${v}%`],
                    ['homeownership_rate', 'Homeownership Rate', (v: number) => `${v}%`],
                  ] as const).map(([field, fieldLabel, format]) => {
                    const value = districtAffordability[field];
                    if (value == null) return null;
                    return (
                      <div key={field} style={{ marginBottom: '10px' }}>
                        <div className="metric-row">
                          <span style={{ fontSize: '12px', color: '#999' }}>{fieldLabel}</span>
                          <span className="metric-value">{format(value)}</span>
                        </div>
                        <AffordabilityTrendChart districtId={district.district_id} field={field} label={fieldLabel} />
                      </div>
                    );
                  })}
                  <div style={{ fontSize: '11px', color: '#ccc', fontStyle: 'italic' }}>
                    Source: Census ACS 5-Year Estimates{acsYear ? ` (${acsYear})` : ''}
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: '12px', color: '#999' }}>No affordability data available for this district.</div>
              )
            ) : (
              getMetricsForComponent(expandedIndex)
                .filter((metricKey) => district.metrics[metricKey])
                .map((metricKey) => {
                  const metric = district.metrics[metricKey];
                  const trendKey = getMetricTrendKey(metricKey);
                  return (
                    <div key={metricKey} style={{ marginBottom: '10px' }}>
                      <div className="metric-label">{getMetricLabel(metricKey)}</div>
                      <div className="metric-row">
                        <span style={{ fontSize: '12px', color: '#999' }}>Count</span>
                        <span className="metric-value">{metric.raw_count.toLocaleString()}</span>
                      </div>
                      <div className="metric-row">
                        <span style={{ fontSize: '12px', color: '#999' }}>Rate</span>
                        <span className="metric-value">{metric.rate_per_1000.toFixed(1)}</span>
                      </div>
                      <div style={{ fontSize: '11px', color: '#ccc' }}>
                        {district.is_radius
                          ? getMetricUnit(metricKey).replace('per 1,000 residents', 'per sq. mi. within 1 mile')
                          : getMetricUnit(metricKey)}
                      </div>
                      <div style={{ fontSize: '11px', color: '#ccc', fontStyle: 'italic' }}>
                        Source: {getMetricSource(metricKey)}
                      </div>
                      {trendKey && !district.is_radius && (
                        <MetricTrendChart
                          districtId={district.district_id}
                          trendKey={trendKey}
                          label={getMetricLabel(metricKey)}
                        />
                      )}
                    </div>
                  );
                })
            )}
          </div>
        )}
      </div>
    </div>
  );
}
