'use client';

import { useEffect, useState } from 'react';
import {
  getMetricLabel,
  getMetricUnit,
  getMetricSource,
  getMetricsForComponent,
  getMetricTrendKey,
  isMetricInverted,
  indexLabels,
  indexDescriptions,
} from '@/lib/metricLabels';
import MetricTrendChart from './MetricTrendChart';
import AffordabilityTrendChart from './AffordabilityTrendChart';
import IndexComparisonChart from './IndexComparisonChart';
import TopDistrictsRanking from './TopDistrictsRanking';
import GradeBadge from './GradeBadge';
import { percentileRank, getLetterGrade } from '@/lib/letterGrade';
import { loadNeighborhoodData } from '@/lib/loadNeighborhoodData';
import { cityForDistrictId } from '@/lib/geo';
import type { Neighborhood } from '@/types/neighborhood';

// Below this magnitude a vs-average difference reads as noise rather than a
// meaningful strength/weakness, so it stays neutral gray instead of
// green/red — a +3% and a +45% shouldn't look equally "good."
const DIFF_PCT_NEUTRAL_THRESHOLD = 10;

function diffColor(diffPct: number | null, isGood: boolean): string {
  if (diffPct == null || Math.abs(diffPct) < DIFF_PCT_NEUTRAL_THRESHOLD) return '#666';
  return isGood ? '#2a9d5c' : '#c0392b';
}

interface NeighborhoodSidebarProps {
  district: Neighborhood | null;
  onSelectDistrict?: (district: Neighborhood) => void;
  granularity?: 'district' | 'zip';
  reviewsUrl?: string | null;
  reviewsLinkIsNamedPlace?: boolean;
}

const COMPONENT_WEIGHTS: { key: 'safety' | 'opportunity' | 'amenities' | 'transportation' | 'affordability'; weight: number }[] = [
  { key: 'safety', weight: 20 },
  { key: 'opportunity', weight: 20 },
  { key: 'amenities', weight: 20 },
  { key: 'transportation', weight: 20 },
  { key: 'affordability', weight: 20 },
];

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

export default function NeighborhoodSidebar({ district, onSelectDistrict, granularity = 'district', reviewsUrl, reviewsLinkIsNamedPlace = false }: NeighborhoodSidebarProps) {
  const [affordability, setAffordability] = useState<Record<string, Affordability>>({});
  const [acsYear, setAcsYear] = useState<number | null>(null);
  const [expandedIndex, setExpandedIndex] = useState<string | null>(null);
  const [allNeighborhoods, setAllNeighborhoods] = useState<Neighborhood[]>([]);
  const [allZips, setAllZips] = useState<Neighborhood[]>([]);

  useEffect(() => {
    Promise.all([
      fetch('/data/affordability_stpaul.json').then((r) => (r.ok ? r.json() : null)) as Promise<AffordabilityFile | null>,
      fetch('/data/affordability_mpls.json').then((r) => (r.ok ? r.json() : null)) as Promise<AffordabilityFile | null>,
      // ZIP codes and district ids never collide, so this can merge
      // straight into the same lookup keyed by district_id/zip code.
      fetch('/data/affordability_zip.json').then((r) => (r.ok ? r.json() : null)) as Promise<AffordabilityFile | null>,
    ])
      .then(([stpaul, mpls, zip]) => {
        setAffordability({ ...(stpaul?.districts || {}), ...(mpls?.districts || {}), ...(zip?.districts || {}) });
        setAcsYear(stpaul?.acs_year ?? mpls?.acs_year ?? zip?.acs_year ?? null);
      })
      .catch(() => setAffordability({}));

    // Letter grades are relative to the district set (see lib/letterGrade.ts),
    // so grading needs every district's scores to rank against, not just
    // the one currently selected.
    Promise.all([loadNeighborhoodData('stpaul'), loadNeighborhoodData('mpls')])
      .then(([stpaul, mpls]) => setAllNeighborhoods([...stpaul.neighborhoods, ...mpls.neighborhoods]))
      .catch(() => setAllNeighborhoods([]));

    // ZIP-granularity selections are normalized in their own separate pool
    // (compute_health_scores_zip — every metro ZIP against every other
    // ZIP), so grading/averaging a ZIP against the 28-district pool below
    // would compare it against the wrong distribution.
    loadNeighborhoodData('zip')
      .then((zip) => setAllZips(zip.neighborhoods))
      .catch(() => setAllZips([]));
  }, []);

  const comparisonPool = district?.is_zip ? allZips : allNeighborhoods;

  const healthScoreGrade =
    district && comparisonPool.length > 0
      ? percentileRank(district.health_score, comparisonPool.map((n) => n.health_score))
      : null;

  const indexGrade = (key: string, value: number): number | null => {
    if (comparisonPool.length === 0) return null;
    const values = comparisonPool
      .map((n) => n.indices[key])
      .filter((v): v is number => v != null);
    if (values.length === 0) return null;
    return percentileRank(value, values);
  };

  // Same-city (or same-pool, for a ZIP selection) average for a raw
  // affordability field, so the panel can show a vs-average diff the same
  // way every other metric already does. Zip codes and district ids never
  // collide numerically, but zips are 5 digits (>= 10000) vs. districts'
  // 1-17/100-111, so that's used to split the combined `affordability`
  // lookup back into the right comparison pool.
  const districtAverageAffordability = (field: keyof Affordability): number | null => {
    if (trendDistrictId == null) return null;
    const isZipPool = district?.is_zip ?? false;
    const sameCity = isZipPool ? null : cityForDistrictId(trendDistrictId);
    const values: number[] = [];
    for (const [key, entry] of Object.entries(affordability)) {
      const id = Number(key);
      const keyIsZip = id >= 10000;
      if (isZipPool !== keyIsZip) continue;
      if (!isZipPool && cityForDistrictId(id) !== sameCity) continue;
      const value = entry[field];
      if (value != null) values.push(value);
    }
    if (values.length === 0) return null;
    return values.reduce((sum, v) => sum + v, 0) / values.length;
  };

  // For metrics with no time-series history, show the average across all
  // (non-radius) districts/zips as a rough point of comparison instead.
  const districtAverageRate = (metricKey: string): number | null => {
    const rates = comparisonPool
      .filter((n) => !n.is_radius)
      .map((n) => n.metrics[metricKey]?.rate_per_1000)
      .filter((v): v is number => v != null);
    if (rates.length === 0) return null;
    return rates.reduce((sum, v) => sum + v, 0) / rates.length;
  };

  const districtAverageIndex = (indexKey: string): number | null => {
    const values = comparisonPool
      .filter((n) => !n.is_radius)
      .map((n) => n.indices[indexKey])
      .filter((v): v is number => v != null);
    if (values.length === 0) return null;
    return values.reduce((sum, v) => sum + v, 0) / values.length;
  };

  if (!district) {
    return (
      <div className="sidebar">
        <div className="no-selection">
          {granularity === 'zip' ? 'Click a ZIP code on the map to view details' : 'Click a district on the map to view details'}
        </div>
        <TopDistrictsRanking onSelectDistrict={onSelectDistrict} granularity={granularity} />
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
      <div className="district-title">
        {district.district_name}
        {district.is_radius && reviewsUrl && (
          <a
            href={reviewsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="district-title-reviews-link"
          >
            {reviewsLinkIsNamedPlace ? 'View reviews on Google Maps ↗' : 'Open in Google Maps ↗'}
          </a>
        )}
      </div>
      {district.is_radius && district.address && (
        <div className="district-address" style={{ fontSize: '13px', color: '#888', marginTop: '-4px', marginBottom: '4px' }}>
          {district.address}
        </div>
      )}
      <div className="district-subtitle">
        {district.is_radius
          ? `1-mile radius${district.population > 0 ? ` • ~${district.population.toLocaleString()} residents nearby` : ''}`
          : `Population: ${district.population.toLocaleString()}`}
      </div>

      <div style={{ fontSize: '13px', fontWeight: 600, color: '#666', marginBottom: '2px' }}>
        Overall Living Quality Score
      </div>
      <div className="health-score-display">
        {Math.round(district.health_score)}
        <GradeBadge percentile={healthScoreGrade} size="large" />
      </div>

      <IndexComparisonChart
        district={district}
        onSelectIndex={(key) => setExpandedIndex(expandedIndex === key ? null : key)}
      />

      <div style={{ marginBottom: '20px' }}>
        <div style={{ fontSize: '13px', fontWeight: '600', marginBottom: '10px', color: '#666' }}>
          Component Scores <span style={{ fontWeight: 400, color: '#999' }}>(click to see what's included)</span>
        </div>
        <div className="index-grid">
          {(['safety', 'opportunity', 'amenities', 'transportation', 'affordability'] as const)
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
                  {Math.round(district.indices[key]!)}
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
                    ['median_home_value', 'Median Home Value', (v: number) => `$${v.toLocaleString()}`, true],
                    ['median_gross_rent', 'Median Gross Rent', (v: number) => `$${v.toLocaleString()}/mo`, true],
                    ['median_household_income', 'Median Household Income', (v: number) => `$${v.toLocaleString()}`, false],
                    ['poverty_rate', 'Poverty Rate', (v: number) => `${v}%`, true],
                    ['housing_cost_burden_rate', 'Housing Cost Burden (renters)', (v: number) => `${v}%`, true],
                    ['homeownership_rate', 'Homeownership Rate', (v: number) => `${v}%`, false],
                  ] as const).map(([field, fieldLabel, format, inverted]) => {
                    const value = districtAffordability[field];
                    if (value == null) return null;
                    const avg = district.is_radius ? null : districtAverageAffordability(field);
                    const diffPct = avg != null && avg !== 0 ? ((value - avg) / avg) * 100 : null;
                    const isGood = diffPct != null && (inverted ? diffPct < 0 : diffPct >= 0);
                    return (
                      <div key={field} style={{ marginBottom: '10px' }}>
                        <div className="metric-row">
                          <span style={{ fontSize: '12px', color: '#999' }}>{fieldLabel}</span>
                          <span className="metric-value">{format(value)}</span>
                        </div>
                        {avg != null && (
                          <div style={{ fontSize: '11px', color: '#999', marginTop: '2px' }}>
                            {district.is_zip ? 'All-zip' : 'Citywide'} avg: {format(Math.round(avg))}
                            {diffPct != null && (
                              <span style={{ color: diffColor(diffPct, isGood) }}>
                                {' '}({diffPct >= 0 ? '+' : ''}{diffPct.toFixed(0)}%)
                              </span>
                            )}
                          </div>
                        )}
                        <AffordabilityTrendChart districtId={trendDistrictId!} field={field} label={fieldLabel} />
                      </div>
                    );
                  })}
                  <div style={{ fontSize: '11px', color: '#ccc', fontStyle: 'italic' }}>
                    Source: Census ACS 5-Year Estimates{acsYear ? ` (${acsYear})` : ''}
                    {district.is_radius ? ' (surrounding district)' : ''}
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: '12px', color: '#999' }}>No affordability data available for this district.</div>
              )
            ) : (
              (() => {
                // broadband_score and walkability_score aren't top-level components — they're
                // sub-scores folded into amenities (85/15) and transportation (70/30)
                // respectively, so they're shown nested under those two instead of getting
                // their own top-level card.
                const renderSubScore = (key: 'walkability_score' | 'broadband_score') => {
                  const value = district.indices[key];
                  if (value == null) return null;
                  const avg = district.is_radius ? null : districtAverageIndex(key);
                  const diffPct = avg != null && avg !== 0 ? ((value - avg) / avg) * 100 : null;
                  return (
                    <div key={key} style={{ marginBottom: '10px' }}>
                      <div className="metric-label">{indexLabels[key]}</div>
                      <div className="metric-row">
                        <span style={{ fontSize: '12px', color: '#999' }}>Score</span>
                        <span className="metric-value">{value.toFixed(1)}</span>
                      </div>
                      {avg != null && (
                        <div style={{ fontSize: '11px', color: '#999', marginTop: '2px' }}>
                          All-district avg score: {avg.toFixed(1)}
                          {diffPct != null && (
                            <span style={{ color: diffColor(diffPct, diffPct >= 0) }}>
                              {' '}({diffPct >= 0 ? '+' : ''}{diffPct.toFixed(0)}%)
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                };

                return (
                  <>
                    {getMetricsForComponent(expandedIndex)
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
                      {!district.is_radius &&
                        (() => {
                          // radius rates use a different unit (per sq. mi.), not comparable to district avg
                          const avg = districtAverageRate(metricKey);
                          if (avg == null) return null;
                          const diffPct = avg !== 0 ? ((metric.rate_per_1000 - avg) / avg) * 100 : null;
                          const isGood = diffPct != null && (isMetricInverted(metricKey) ? diffPct < 0 : diffPct >= 0);
                          return (
                            <div style={{ fontSize: '11px', color: '#999', marginTop: '2px' }}>
                              All-district avg rate: {avg.toFixed(1)}
                              {diffPct != null && (
                                <span style={{ color: diffColor(diffPct, isGood) }}>
                                  {' '}({diffPct >= 0 ? '+' : ''}{diffPct.toFixed(0)}%)
                                </span>
                              )}
                            </div>
                          );
                        })()}
                      {trendKey && trendDistrictId != null && (
                        <>
                          <MetricTrendChart
                            districtId={trendDistrictId}
                            trendKey={trendKey}
                            label={getMetricLabel(metricKey)}
                          />
                          {district.is_radius && (
                            <div style={{ fontSize: '10px', color: '#ccc', fontStyle: 'italic', marginTop: '-4px' }}>
                              Trend shown for the surrounding district; no history for an arbitrary point.
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
                    {expandedIndex === 'amenities' && renderSubScore('broadband_score')}
                    {expandedIndex === 'transportation' && renderSubScore('walkability_score')}
                  </>
                );
              })()
            )}
          </div>
        )}
      </div>

      {(() => {
        const componentPercentiles = COMPONENT_WEIGHTS
          .filter(({ key }) => district.indices[key] != null)
          .map(({ key }) => ({
            key,
            label: indexLabels[key],
            score: district.indices[key]!,
            percentile: indexGrade(key, district.indices[key]!),
          }))
          .filter((c): c is typeof c & { percentile: number } => c.percentile != null);

        if (componentPercentiles.length === 0) return null;

        const strengths = componentPercentiles
          .filter((c) => c.percentile >= 65)
          .sort((a, b) => b.percentile - a.percentile)
          .slice(0, 3);
        const weaknesses = componentPercentiles
          .filter((c) => c.percentile <= 35)
          .sort((a, b) => a.percentile - b.percentile)
          .slice(0, 3);

        const summarize = () => {
          if (strengths.length === 0 && weaknesses.length === 0) {
            return "Scores close to average across the board relative to other districts.";
          }
          const parts: string[] = [];
          if (strengths.length > 0) {
            parts.push(`Strong ${strengths.map((s) => s.label.toLowerCase()).join(' and ')}`);
          }
          if (weaknesses.length > 0) {
            parts.push(`${weaknesses.length > 1 ? 'weaker' : 'lower'} ${weaknesses.map((w) => w.label.toLowerCase()).join(' and ')}`);
          }
          const sentence = parts.join(', but ') + ' relative to other districts.';
          return sentence.charAt(0).toUpperCase() + sentence.slice(1);
        };

        return (
          <>
            <div style={{ marginBottom: '20px' }}>
              <div style={{ fontSize: '13px', fontWeight: '600', marginBottom: '8px', color: '#666', display: 'flex', alignItems: 'center' }}>
                <span>Why a</span>
                {healthScoreGrade != null && <GradeBadge percentile={healthScoreGrade} />}
                <span style={{ marginLeft: '6px' }}>for {district.district_name}?</span>
              </div>
              <div style={{ fontSize: '13px', color: '#444', lineHeight: 1.5, marginBottom: '10px' }}>
                {summarize()}
              </div>
              {strengths.length > 0 && (
                <div style={{ marginBottom: '8px' }}>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: '#2a9d5c', marginBottom: '4px' }}>
                    Top strengths
                  </div>
                  <ul style={{ paddingLeft: '18px', fontSize: '12px', color: '#555' }}>
                    {strengths.map((s) => (
                      <li key={s.key}>{s.label} — top {Math.max(1, Math.round(100 - s.percentile))}% of districts</li>
                    ))}
                  </ul>
                </div>
              )}
              {weaknesses.length > 0 && (
                <div>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: '#c0392b', marginBottom: '4px' }}>
                    Weaknesses
                  </div>
                  <ul style={{ paddingLeft: '18px', fontSize: '12px', color: '#555' }}>
                    {weaknesses.map((w) => (
                      <li key={w.key}>{w.label} — bottom {Math.max(1, Math.round(w.percentile))}% of districts</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </>
        );
      })()}

    </div>
  );
}
