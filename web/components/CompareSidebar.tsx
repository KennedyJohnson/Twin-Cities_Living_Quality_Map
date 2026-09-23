'use client';

import {
  getMetricLabel,
  getMetricUnit,
  getMetricsForComponent,
  isMetricInverted,
  indexLabels,
} from '@/lib/metricLabels';
import { useEffect, useState } from 'react';
import type { ListingPrefs } from '@/lib/listingLinks';
import type { Neighborhood } from '@/types/neighborhood';
import { loadBudgetData, DistrictBudget } from '@/lib/budgetData';
import { boundsCenter } from '@/lib/listingLinks';
import { estimateCommute, useWorkLocation } from '@/lib/commute';
import { ListingLinks, useAreaBounds, WorkAddressInput } from '@/components/AreaGuide';

interface CompareSidebarProps {
  districtA: Neighborhood;
  districtB: Neighborhood;
  onClose: () => void;
  maxRent?: number | null;
  maxHomeValue?: number | null;
  housingMode?: 'rent' | 'buy';
  minBeds?: number | null;
  listingPrefs?: ListingPrefs;
}

const COMPONENT_KEYS = ['safety', 'opportunity', 'amenities', 'transportation', 'affordability'] as const;

// Green/red only kicks in once the gap is big enough to read as a real
// difference rather than noise — mirrors NeighborhoodSidebar's vs-average
// diff-coloring threshold.
const DIFF_PCT_NEUTRAL_THRESHOLD = 10;

function diffColor(diffPct: number | null, isGood: boolean): string {
  if (diffPct == null || Math.abs(diffPct) < DIFF_PCT_NEUTRAL_THRESHOLD) return '#666';
  return isGood ? '#2a9d5c' : '#c0392b';
}

function pctDiff(a: number, b: number): number | null {
  if (b === 0) return null;
  return ((a - b) / Math.abs(b)) * 100;
}

function ScoreRow({
  label,
  valueA,
  valueB,
  inverted = false,
  format = (v: number) => Math.round(v).toString(),
}: {
  label: string;
  valueA: number | null | undefined;
  valueB: number | null | undefined;
  inverted?: boolean;
  format?: (v: number) => string;
}) {
  if (valueA == null && valueB == null) return null;
  const diffPct = valueA != null && valueB != null ? pctDiff(valueA, valueB) : null;
  const aIsGood = diffPct != null && (inverted ? diffPct < 0 : diffPct >= 0);
  const bIsGood = diffPct != null && !aIsGood;

  return (
    <div className="compare-row" style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '8px', alignItems: 'baseline', padding: '6px 0', borderBottom: '1px solid #eee' }}>
      <span style={{ fontSize: '12px', color: '#666' }}>{label}</span>
      <span style={{ fontSize: '13px', fontWeight: 600, color: valueA != null && diffPct != null ? diffColor(diffPct, aIsGood) : '#333', textAlign: 'right', minWidth: '48px' }}>
        {valueA != null ? format(valueA) : '—'}
      </span>
      <span style={{ fontSize: '13px', fontWeight: 600, color: valueB != null && diffPct != null ? diffColor(diffPct, bIsGood) : '#333', textAlign: 'right', minWidth: '48px' }}>
        {valueB != null ? format(valueB) : '—'}
      </span>
    </div>
  );
}

export default function CompareSidebar({ districtA, districtB, onClose, maxRent = null, maxHomeValue = null, housingMode, minBeds = null, listingPrefs }: CompareSidebarProps) {
  const [budget, setBudget] = useState<Record<number, DistrictBudget>>({});
  useEffect(() => {
    loadBudgetData().then(setBudget);
  }, []);
  const boundsA = useAreaBounds(districtA);
  const boundsB = useAreaBounds(districtB);
  const work = useWorkLocation();
  const commuteA = work && boundsA ? estimateCommute(boundsCenter(boundsA), work) : null;
  const commuteB = work && boundsB ? estimateCommute(boundsCenter(boundsB), work) : null;
  const money = (v: number) => `$${Math.round(v).toLocaleString()}`;
  const filters = { maxRent, maxHomeValue, mode: housingMode, minBeds, prefs: listingPrefs };

  return (
    <div className="sidebar">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: '#666' }}>Comparing</div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button type="button" onClick={onClose} style={{ fontSize: '12px', background: 'none', border: '1px solid #ccc', borderRadius: '4px', padding: '3px 8px', cursor: 'pointer' }}>
            Exit compare
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '8px', marginBottom: '4px' }}>
        <span />
        <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--accent)', textAlign: 'right' }}>{districtA.district_name}</span>
        <span style={{ fontSize: '12px', fontWeight: 700, color: '#e6550d', textAlign: 'right' }}>{districtB.district_name}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '8px', marginBottom: '16px' }}>
        <span style={{ fontSize: '11px', color: '#999' }}>Population</span>
        <span style={{ fontSize: '12px', color: '#999', textAlign: 'right' }}>{districtA.population.toLocaleString()}</span>
        <span style={{ fontSize: '12px', color: '#999', textAlign: 'right' }}>{districtB.population.toLocaleString()}</span>
      </div>

      <div style={{ fontSize: '13px', fontWeight: 600, color: '#666', marginBottom: '4px' }}>
        Overall Living Quality Score
      </div>
      <ScoreRow label="Score (0-100)" valueA={districtA.health_score} valueB={districtB.health_score} />

      <div style={{ fontSize: '13px', fontWeight: 600, color: '#666', margin: '16px 0 4px' }}>
        Cost &amp; Commute
      </div>
      <ScoreRow label="Typical rent (Census median)" valueA={budget[districtA.district_id]?.median_gross_rent} valueB={budget[districtB.district_id]?.median_gross_rent} inverted format={money} />
      <ScoreRow label="Typical home value" valueA={budget[districtA.district_id]?.median_home_value} valueB={budget[districtB.district_id]?.median_home_value} inverted format={money} />
      <ScoreRow label="Est. drive to work (min)" valueA={commuteA?.driveMin} valueB={commuteB?.driveMin} inverted />
      <ScoreRow label="Est. transit to work (min)" valueA={commuteA?.transitMin} valueB={commuteB?.transitMin} inverted />
      <div style={{ margin: '6px 0' }}>
        <WorkAddressInput />
      </div>
      <div style={{ fontSize: '13px', fontWeight: 600, color: '#666', margin: '16px 0 4px' }}>
        Component Scores
      </div>
      {COMPONENT_KEYS.map((key) => (
        <ScoreRow key={key} label={indexLabels[key]} valueA={districtA.indices[key]} valueB={districtB.indices[key]} />
      ))}

      <div style={{ fontSize: '13px', fontWeight: 600, color: '#666', margin: '16px 0 4px' }}>
        Underlying Metrics
      </div>
      {COMPONENT_KEYS.map((componentKey) => {
        const metricKeys = getMetricsForComponent(componentKey).filter(
          (k) => districtA.metrics[k] || districtB.metrics[k]
        );
        if (metricKeys.length === 0) return null;
        return (
          <div key={componentKey} style={{ marginBottom: '12px' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: '#999', marginBottom: '2px' }}>
              {indexLabels[componentKey]}
            </div>
            {metricKeys.map((metricKey) => (
              <ScoreRow
                key={metricKey}
                label={`${getMetricLabel(metricKey)} (${getMetricUnit(metricKey)})`}
                valueA={districtA.metrics[metricKey]?.rate_per_1000}
                valueB={districtB.metrics[metricKey]?.rate_per_1000}
                inverted={isMetricInverted(metricKey)}
                format={(v) => v.toFixed(1)}
              />
            ))}
          </div>
        );
      })}

      <div style={{ fontSize: '13px', fontWeight: 600, color: '#666', margin: '16px 0 4px' }}>
        Listings
      </div>
      {[districtA, districtB].map((d, i) => (
        <div key={d.district_id} style={{ marginBottom: '10px' }}>
          <div style={{ fontSize: '12px', fontWeight: 700, color: i === 0 ? '#756bb1' : '#e6550d', marginBottom: '2px' }}>{d.district_name}</div>
          <ListingLinks district={d} bounds={i === 0 ? boundsA : boundsB} filters={filters} />
        </div>
      ))}

      <div style={{ fontSize: '11px', color: '#aaa', marginTop: '8px' }}>
        Green/red highlights a gap of more than {DIFF_PCT_NEUTRAL_THRESHOLD}% between the two, colored toward whichever side is better for that metric.
      </div>
    </div>
  );
}
