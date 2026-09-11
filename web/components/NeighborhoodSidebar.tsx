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
import GradeBadge from './GradeBadge';
import { percentileRank } from '@/lib/letterGrade';
import { loadNeighborhoodData } from '@/lib/loadNeighborhoodData';
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
  const [allNeighborhoods, setAllNeighborhoods] = useState<Neighborhood[]>([]);

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

    // Letter grades are relative to the district set (see lib/letterGrade.ts),
    // so grading needs every district's scores to rank against, not just
    // the one currently selected.
    Promise.all([loadNeighborhoodData('stpaul'), loadNeighborhoodData('mpls')])
      .then(([stpaul, mpls]) => setAllNeighborhoods([...stpaul.neighborhoods, ...mpls.neighborhoods]))
      .catch(() => setAllNeighborhoods([]));
  }, []);

  const healthScoreGrade =
    district && allNeighborhoods.length > 0
      ? percentileRank(district.health_score, allNeighborhoods.map((n) => n.health_score))
      : null;

  const indexGrade = (key: string, value: number): number | null => {
    if (allNeighborhoods.length === 0) return null;
    const values = allNeighborhoods
      .map((n) => n.indices[key])
      .filter((v): v is number => v != null);
    if (values.length === 0) return null;
    return percentileRank(value, values);
  };

  if (!district) {
    return (
      <div className="sidebar">
        <div className="no-selection">Click a district on the map to view details</div>
        <TopDistrictsRanking onSelectDistrict={onSelectDistrict} />
      </div>
    );
  }

  // For a radius/place selection, fall back to the enclosing district's
  // affordability trend — there's no location-specific ACS history for an
  // arbitrary point, so the surrounding district is the closest available.
  const trendDistrictId = district.is_radius ? district.containing_district_id : district.district_id;
  const districtAffordability = trendDistrictId != null ? affordability[String(trendDistrictId)] : undefined;

  return (
    <div className="sidebar">
      <div className="district-title">{district.district_name}</div>
      <div className="district-subtitle">
        {district.is_radius
          ? `1-mile radius${district.population > 0 ? ` • ~${district.population.toLocaleString()} residents nearby` : ''}`
          : `Population: ${district.population.toLocaleString()}`}
      </div>

      <div className="health-score-display">
        {district.health_score.toFixed(1)}
        <GradeBadge percentile={healthScoreGrade} size="large" />
      </div>

      <IndexComparisonChart district={district} />

      <div style={{ marginBottom: '20px' }}>
        <div style={{ fontSize: '13px', fontWeight: '600', marginBottom: '10px', color: '#666' }}>
          Component Scores <span style={{ fontWeight: 400, color: '#999' }}>(click to see what's included)</span>
        </div>
        <div className="index-grid">
          {(['safety', 'opportunity', 'amenities', 'transportation', 'affordability', 'walkability_score'] as const)
            .filter((key) => district.indices[key] != null)
            .map((key) => (
              <div
                key={key}
                className="index-card"
                onClick={() => setExpandedIndex(expandedIndex === key ? null : key)}
                style={{ cursor: 'pointer', border: expandedIndex === key ? '2px solid #756bb1' : undefined }}
              >
                <div className="index-name">{indexLabels[key]}</div>
                <div className="index-score">
                  {district.indices[key]!.toFixed(1)}
                  <GradeBadge percentile={indexGrade(key, district.indices[key]!)} />
                </div>
              </div>
            ))}
        </div>

        {expandedIndex && (
          <div style={{ marginTop: '12px', padding: '10px', background: '#f7f7f9', borderRadius: '6px' }}>
            <div style={{ fontSize: '12px', color: '#555', marginBottom: '10px', lineHeight: 1.4 }}>
              {indexDescriptions[expandedIndex]}
            </div>
            {expandedIndex === 'affordability' ? (
              district.is_radius && !district.containing_district_id ? (
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
                        <AffordabilityTrendChart districtId={trendDistrictId!} field={field} label={fieldLabel} />
                      </div>
                    );
                  })}
                  <div style={{ fontSize: '11px', color: '#ccc', fontStyle: 'italic' }}>
                    Source: Census ACS 5-Year Estimates{acsYear ? ` (${acsYear})` : ''}
                    {district.is_radius ? ' — surrounding district' : ''}
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
                      {trendKey && trendDistrictId != null && (
                        <>
                          <MetricTrendChart
                            districtId={trendDistrictId}
                            trendKey={trendKey}
                            label={getMetricLabel(metricKey)}
                          />
                          {district.is_radius && (
                            <div style={{ fontSize: '10px', color: '#ccc', fontStyle: 'italic', marginTop: '-4px' }}>
                              Trend shown for the surrounding district — no history for an arbitrary point.
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  );
                })
            )}
          </div>
        )}
      </div>

      {district.is_radius && (
        <div style={{ fontSize: '11px', color: '#999', lineHeight: 1.4 }}>
          Estimated from OpenStreetMap + Census data within 1 mile using per-area rates. Excludes metrics only available at the district level (weight redistributed) and Walk/Bike Score's distance decay. District scores use the full metric set.
        </div>
      )}

      {!district.is_radius && (
        <div style={{ fontSize: '11px', color: '#999', marginTop: '16px', lineHeight: 1.4 }}>
          {healthScoreMethodology}
        </div>
      )}
    </div>
  );
}
