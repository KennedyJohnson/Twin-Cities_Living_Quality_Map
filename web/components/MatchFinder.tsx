'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { loadBudgetData, isWithinBudget, DistrictBudget } from '@/lib/budgetData';
import { loadNeighborhoodData } from '@/lib/loadNeighborhoodData';
import {
  computeMatchScore,
  hasActiveWeights,
  MatchComponent,
  MatchWeights,
  DEFAULT_MATCH_WEIGHTS,
} from '@/lib/scoreMetric';
import type { Neighborhood } from '@/types/neighborhood';
import { cityForDistrictId } from '@/lib/geo';
import {
  MatchRegion,
  MatchRegionBuilding,
  MATCH_REGION_RADIUS_METERS,
  haversineMeters,
} from '@/lib/matchRegions';

const COMPONENT_LABELS: Record<MatchComponent, string> = {
  safety: 'Safety',
  opportunity: 'Opportunity',
  amenities: 'Amenities & Services',
  transportation: 'Transportation',
  affordability: 'Economic Profile',
};

const COMPONENT_ORDER: MatchComponent[] = ['safety', 'opportunity', 'amenities', 'transportation', 'affordability'];

const IMPORTANCE_LEVELS: { value: number; label: string }[] = [
  { value: 0, label: 'Not important' },
  { value: 33, label: 'Somewhat' },
  { value: 67, label: 'Important' },
  { value: 100, label: 'Very important' },
];

function closestLevelIndex(value: number): number {
  let closest = 0;
  let closestDist = Infinity;
  IMPORTANCE_LEVELS.forEach((level, i) => {
    const dist = Math.abs(level.value - value);
    if (dist < closestDist) {
      closestDist = dist;
      closest = i;
    }
  });
  return closest;
}

// Raw shape of web/public/data/apartment_buildings_{city}.json, written by
// pipeline/build.py's build_apartment_buildings() using the same 1-mile
// radius scoring algorithm as a map-click "place" search
// (pipeline/core/radius_score.py, ported from web/lib/radiusScore.ts).
interface ApartmentBuildingRecord {
  id: string;
  name: string;
  address: string | null;
  lat: number;
  lon: number;
  district_id: number;
  health_score: number;
  indices: Neighborhood['indices'];
}

function buildingToNeighborhood(building: ApartmentBuildingRecord): Neighborhood {
  return {
    district_id: -1,
    district_name: building.name,
    population: 0,
    metrics: {},
    indices: building.indices,
    health_score: building.health_score,
    is_radius: true,
    containing_district_id: building.district_id,
    address: building.address ?? undefined,
  };
}

async function loadApartmentBuildings(city: 'stpaul' | 'mpls'): Promise<ApartmentBuildingRecord[]> {
  const res = await fetch(`/data/apartment_buildings_${city}.json`);
  if (!res.ok) return [];
  return res.json();
}

interface MatchFinderProps {
  weights: MatchWeights;
  onWeightsChange: (weights: MatchWeights) => void;
  maxRent: number | null;
  onMaxRentChange: (value: number | null) => void;
  maxHomeValue: number | null;
  onMaxHomeValueChange: (value: number | null) => void;
  onRegionsChange: (regions: MatchRegion[]) => void;
  activeRegionId: string | null;
  onSelectRegion: (region: MatchRegion) => void;
  onClose: () => void;
  cityFilter: 'all' | 'stpaul' | 'mpls';
  onCityFilterChange: (city: 'all' | 'stpaul' | 'mpls') => void;
}

export default function MatchFinder({
  weights,
  onWeightsChange,
  maxRent,
  onMaxRentChange,
  maxHomeValue,
  onMaxHomeValueChange,
  onRegionsChange,
  activeRegionId,
  onSelectRegion,
  onClose,
  cityFilter,
  onCityFilterChange,
}: MatchFinderProps) {
  const [allBuildings, setAllBuildings] = useState<ApartmentBuildingRecord[]>([]);
  const [districts, setDistricts] = useState<Neighborhood[]>([]);
  const [budgetByDistrict, setBudgetByDistrict] = useState<Record<number, DistrictBudget>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [stpaulBuildings, mplsBuildings, budget, stpaulData, mplsData] = await Promise.all([
          loadApartmentBuildings('stpaul').catch(() => []),
          loadApartmentBuildings('mpls').catch(() => []),
          loadBudgetData(),
          loadNeighborhoodData('stpaul').catch(() => ({ neighborhoods: [] as Neighborhood[] })),
          loadNeighborhoodData('mpls').catch(() => ({ neighborhoods: [] as Neighborhood[] })),
        ]);
        if (cancelled) return;
        setAllBuildings([...stpaulBuildings, ...mplsBuildings]);
        setBudgetByDistrict(budget);
        setDistricts([...stpaulData.neighborhoods, ...mplsData.neighborhoods]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const weightsActive = hasActiveWeights(weights);

  // Every building in this dataset is an OSM building=apartments record (see
  // clean_apartment_buildings.py) — there's no condo/townhome/house
  // classification available to filter on.
  const buildingsWithinBudget = useMemo(() => {
    return allBuildings.filter(
      (b) =>
        (cityFilter === 'all' || cityForDistrictId(b.district_id) === cityFilter) &&
        isWithinBudget(budgetByDistrict[b.district_id], maxRent, maxHomeValue)
    );
  }, [allBuildings, budgetByDistrict, maxRent, maxHomeValue, cityFilter]);

  const excludedCount = allBuildings.length - buildingsWithinBudget.length;

  // Rank districts (not individual listings) by fit, then anchor each top
  // district's 1-mile recommendation radius on its own highest-scoring
  // apartment building — see web/lib/matchRegions.ts for why: we're
  // recommending an area to go explore, not steering someone toward one
  // specific address.
  const regions: MatchRegion[] = useMemo(() => {
    if (!weightsActive || buildingsWithinBudget.length === 0) return [];

    const buildingsByDistrict = new Map<number, ApartmentBuildingRecord[]>();
    for (const b of buildingsWithinBudget) {
      const list = buildingsByDistrict.get(b.district_id);
      if (list) list.push(b);
      else buildingsByDistrict.set(b.district_id, [b]);
    }

    const rankedDistricts = districts
      .filter(
        (d) =>
          (cityFilter === 'all' || cityForDistrictId(d.district_id) === cityFilter) &&
          isWithinBudget(budgetByDistrict[d.district_id], maxRent, maxHomeValue)
      )
      .map((district) => ({ district, score: computeMatchScore(district, weights) }))
      .sort((a, b) => b.score - a.score);

    const out: MatchRegion[] = [];
    for (const { district, score } of rankedDistricts) {
      const candidates = buildingsByDistrict.get(district.district_id);
      // No apartment buildings in this district to anchor a radius on — skip
      // it rather than recommend a region with nothing to click.
      if (!candidates || candidates.length === 0) continue;

      let center = candidates[0];
      let bestScore = -Infinity;
      for (const b of candidates) {
        const s = computeMatchScore(buildingToNeighborhood(b), weights);
        if (s > bestScore) {
          bestScore = s;
          center = b;
        }
      }

      const nearby: MatchRegionBuilding[] = buildingsWithinBudget
        .filter((b) => haversineMeters(center.lat, center.lon, b.lat, b.lon) <= MATCH_REGION_RADIUS_METERS)
        .map((b) => ({ id: b.id, name: b.name, address: b.address, lat: b.lat, lon: b.lon }));

      out.push({
        id: `district-${district.district_id}`,
        rank: out.length + 1,
        districtId: district.district_id,
        districtName: district.district_name,
        center: { lat: center.lat, lon: center.lon },
        radiusMeters: MATCH_REGION_RADIUS_METERS,
        districtScore: score,
        buildings: nearby,
      });
      if (out.length === 5) break;
    }
    return out;
  }, [buildingsWithinBudget, districts, budgetByDistrict, weights, maxRent, maxHomeValue, weightsActive, cityFilter]);

  const onRegionsChangeRef = useRef(onRegionsChange);
  onRegionsChangeRef.current = onRegionsChange;
  useEffect(() => {
    onRegionsChangeRef.current(regions);
  }, [regions]);

  return (
    <div className="match-finder-panel">
      <div className="match-finder-header">
        <h3>Find Your Match</h3>
        <button type="button" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>

      <div className="match-finder-section">
        <div className="match-finder-section-title">City</div>
        <div className="click-mode-toggle-buttons">
          {([
            ['all', 'Both'],
            ['stpaul', 'St. Paul'],
            ['mpls', 'Minneapolis'],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={cityFilter === value ? 'active' : ''}
              onClick={() => onCityFilterChange(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="match-finder-section">
        <div className="match-finder-section-title">How much does each matter?</div>
        {COMPONENT_ORDER.map((component) => {
          const activeIndex = closestLevelIndex(weights[component]);
          return (
            <div key={component} className="match-finder-slider-row">
              <div className="match-finder-slider-row-header">
                <label>{COMPONENT_LABELS[component]}</label>
                <span className="match-finder-slider-value">
                  {IMPORTANCE_LEVELS[activeIndex].label}
                </span>
              </div>
              <div className="match-finder-slider-track">
                <input
                  type="range"
                  min={0}
                  max={IMPORTANCE_LEVELS.length - 1}
                  step={1}
                  value={activeIndex}
                  onChange={(e) =>
                    onWeightsChange({ ...weights, [component]: IMPORTANCE_LEVELS[Number(e.target.value)].value })
                  }
                  className="match-finder-importance-slider"
                />
                <div className="match-finder-slider-notches" aria-hidden="true">
                  {IMPORTANCE_LEVELS.map((level) => (
                    <span key={level.label} className="match-finder-slider-notch" />
                  ))}
                </div>
              </div>
            </div>
          );
        })}
        <button
          type="button"
          className="match-finder-reset"
          onClick={() => onWeightsChange({ ...DEFAULT_MATCH_WEIGHTS })}
        >
          Reset to equal weights
        </button>
      </div>

      <div className="match-finder-section">
        <div className="match-finder-section-title">Budget</div>
        <div className="match-finder-budget-row">
          <label htmlFor="max-rent">Max monthly rent</label>
          <input
            id="max-rent"
            type="number"
            placeholder="No limit"
            min={0}
            step={50}
            value={maxRent ?? ''}
            onChange={(e) => onMaxRentChange(e.target.value === '' ? null : Number(e.target.value))}
          />
        </div>
        <div className="match-finder-budget-row">
          <label htmlFor="max-home-value">Max home value</label>
          <input
            id="max-home-value"
            type="number"
            placeholder="No limit"
            min={0}
            step={5000}
            value={maxHomeValue ?? ''}
            onChange={(e) => onMaxHomeValueChange(e.target.value === '' ? null : Number(e.target.value))}
          />
        </div>
        {excludedCount > 0 && (
          <div className="match-finder-excluded-note">
            {excludedCount} building{excludedCount === 1 ? '' : 's'} over budget, excluded from results.
          </div>
        )}
      </div>

      <div className="match-finder-section">
        {loading ? (
          <div className="match-finder-loading">Loading…</div>
        ) : !weightsActive ? (
          <div className="match-finder-no-results">
            Set at least one preference above 0 to rank areas.
          </div>
        ) : regions.length === 0 ? (
          <div className="match-finder-no-results">No areas fit that budget. Try raising your limits.</div>
        ) : null}
      </div>

      {weightsActive && regions.length > 0 && (
        <div className="match-finder-section">
          <div className="match-finder-section-title">Top 5 recommended areas</div>
          <p className="match-finder-region-hint">
            Each option is a district that fits your criteria, shown as a 1-mile radius on the map. Pick one, then
            click any building marker inside it to look up that place.
          </p>
          <ol className="match-finder-listings">
            {regions.map((region) => (
              <li key={region.id} className="match-finder-listing-item">
                <button
                  type="button"
                  className={`match-finder-listing-header${activeRegionId === region.id ? ' active' : ''}`}
                  onClick={() => onSelectRegion(region)}
                >
                  <span className="match-finder-rank">{region.rank}</span>
                  <span className="match-finder-result-name">
                    {region.districtName}
                    <span className="match-finder-result-address">
                      {' '}
                      ({region.buildings.length} building{region.buildings.length === 1 ? '' : 's'} nearby)
                    </span>
                  </span>
                  <span className="match-finder-result-score">{region.districtScore.toFixed(0)}</span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
