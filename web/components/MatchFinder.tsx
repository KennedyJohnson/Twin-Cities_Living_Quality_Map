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
  houseTypesFor,
  includesApartments,
  housesInRegion,
} from '@/lib/matchRegions';
import { estimateCommute, useWorkLocation } from '@/lib/commute';
import { WorkAddressInput } from '@/components/AreaGuide';
import type { HomeType, ListingPrefs } from '@/lib/listingLinks';

const COMPONENT_LABELS: Record<MatchComponent, string> = {
  safety: 'Safety',
  opportunity: 'Opportunity',
  amenities: 'Amenities & Services',
  transportation: 'Transportation',
  affordability: 'Economic Profile',
};

const HOME_TYPE_OPTIONS: Record<'rent' | 'buy', [HomeType, string][]> = {
  rent: [['apartment', 'Apartment'], ['house', 'House'], ['townhome', 'Townhome'], ['condo', 'Condo']],
  buy: [['house', 'House'], ['townhome', 'Townhome'], ['condo', 'Condo'], ['multifamily', 'Multi-family']],
};
const PET_OPTIONS: [NonNullable<ListingPrefs['pets']>[number], string][] = [
  ['largeDogs', 'Large dogs'],
  ['smallDogs', 'Small dogs'],
  ['cats', 'Cats'],
];

function toggle<T>(list: T[] | undefined, value: T): T[] {
  const cur = list ?? [];
  return cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
}

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

function describeBuildings(buildings: MatchRegionBuilding[]): string {
  const houses = buildings.filter((b) => b.kind === 'house').length;
  const apts = buildings.length - houses;
  const parts = [];
  if (apts > 0 || houses === 0) parts.push(`${apts} apt${apts === 1 ? '' : 's'}`);
  if (houses > 0) parts.push(`${houses.toLocaleString()} house${houses === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

interface MatchFinderProps {
  weights: MatchWeights;
  onWeightsChange: (weights: MatchWeights) => void;
  maxRent: number | null;
  onMaxRentChange: (value: number | null) => void;
  maxHomeValue: number | null;
  onMaxHomeValueChange: (value: number | null) => void;
  housingMode: 'rent' | 'buy';
  onHousingModeChange: (mode: 'rent' | 'buy') => void;
  minBeds: number | null;
  onMinBedsChange: (value: number | null) => void;
  listingPrefs: ListingPrefs;
  onListingPrefsChange: (prefs: ListingPrefs) => void;
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
  housingMode,
  onHousingModeChange,
  minBeds,
  onMinBedsChange,
  listingPrefs,
  onListingPrefsChange,
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
  const work = useWorkLocation();
  const setPref = (patch: Partial<ListingPrefs>) => onListingPrefsChange({ ...listingPrefs, ...patch });
  // Max estimated drive time (minutes) from a region's center to the user's
  // work address; null = no limit.
  const [maxCommuteMin, setMaxCommuteMin] = useState<number | null>(null);
  const commuteLimit = work ? maxCommuteMin : null;

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
  const wantApartments = includesApartments(listingPrefs.homeTypes);
  const houseTypes = useMemo(() => houseTypesFor(listingPrefs.homeTypes), [listingPrefs.homeTypes]);

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

      let center: ApartmentBuildingRecord | null = null;
      let bestScore = -Infinity;
      for (const b of candidates) {
        if (commuteLimit != null && estimateCommute(b, work!).driveMin > commuteLimit) continue;
        const s = computeMatchScore(buildingToNeighborhood(b), weights);
        if (s > bestScore) {
          bestScore = s;
          center = b;
        }
      }
      // Every building in this district is past the commute limit.
      if (!center) continue;

      // Apartments still anchor the region (they carry precomputed radius
      // scores; houses don't), but are only listed if a matching home type
      // is selected. Houses are added afterwards from Supabase.
      const nearby: MatchRegionBuilding[] = (wantApartments ? buildingsWithinBudget : [])
        .filter((b) => haversineMeters(center.lat, center.lon, b.lat, b.lon) <= MATCH_REGION_RADIUS_METERS)
        .map((b) => ({ id: b.id, kind: 'apartment' as const, name: b.name, address: b.address, lat: b.lat, lon: b.lon }));

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
  }, [buildingsWithinBudget, districts, budgetByDistrict, weights, maxRent, maxHomeValue, weightsActive, cityFilter, commuteLimit, work, wantApartments]);

  // Houses inside each recommended region, fetched from Supabase PostGIS
  // once per region/home-type combination.
  const [housesByRegion, setHousesByRegion] = useState<Record<string, MatchRegionBuilding[]>>({});
  const houseFetchKey = regions.map((r) => `${r.id}@${r.center.lat},${r.center.lon}`).join('|') + '#' + houseTypes.join(',');
  useEffect(() => {
    let cancelled = false;
    Promise.all(
      regions.map(async (r) => [r.id, await housesInRegion(r.center, r.radiusMeters, houseTypes)] as const)
    ).then((entries) => {
      if (!cancelled) setHousesByRegion(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
    // houseFetchKey captures everything in regions/houseTypes this depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [houseFetchKey]);

  const regionsWithHouses: MatchRegion[] = useMemo(
    () => regions.map((r) => ({ ...r, buildings: [...r.buildings, ...(housesByRegion[r.id] ?? [])] })),
    [regions, housesByRegion]
  );

  const onRegionsChangeRef = useRef(onRegionsChange);
  onRegionsChangeRef.current = onRegionsChange;
  useEffect(() => {
    onRegionsChangeRef.current(regionsWithHouses);
  }, [regionsWithHouses]);

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
        <div className="click-mode-toggle-buttons" style={{ marginBottom: '8px' }}>
          {(['rent', 'buy'] as const).map((m) => (
            <button
              key={m}
              type="button"
              className={housingMode === m ? 'active' : ''}
              onClick={() => onHousingModeChange(m)}
            >
              {m === 'rent' ? 'Renting' : 'Buying'}
            </button>
          ))}
        </div>
        {housingMode === 'rent' ? (
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
        ) : (
          <div className="match-finder-budget-row">
            <label htmlFor="max-home-value">Max home price</label>
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
        )}
        <div className="match-finder-budget-row">
          <label htmlFor="min-beds">Bedrooms</label>
          <select
            id="min-beds"
            value={minBeds ?? ''}
            onChange={(e) => onMinBedsChange(e.target.value === '' ? null : Number(e.target.value))}
          >
            <option value="">Any</option>
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>{n}+</option>
            ))}
          </select>
        </div>
        <div className="match-finder-budget-row">
          <label htmlFor="min-baths">Bathrooms</label>
          <select
            id="min-baths"
            value={listingPrefs.minBaths ?? ''}
            onChange={(e) => setPref({ minBaths: e.target.value === '' ? null : Number(e.target.value) })}
          >
            <option value="">Any</option>
            {[1, 1.5, 2, 3].map((n) => (
              <option key={n} value={n}>{n}+</option>
            ))}
          </select>
        </div>
        <div style={{ fontSize: '12px', color: '#666', margin: '6px 0 2px' }}>Home type</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 10px', fontSize: '12px' }}>
          {HOME_TYPE_OPTIONS[housingMode].map(([value, label]) => (
            <label key={value}>
              <input
                type="checkbox"
                checked={listingPrefs.homeTypes?.includes(value) ?? false}
                onChange={() => setPref({ homeTypes: toggle(listingPrefs.homeTypes, value) })}
              />{' '}
              {label}
            </label>
          ))}
        </div>
        {housingMode === 'rent' ? (
          <>
            <div style={{ fontSize: '12px', color: '#666', margin: '6px 0 2px' }}>Pets &amp; amenities</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 10px', fontSize: '12px' }}>
              {PET_OPTIONS.map(([value, label]) => (
                <label key={value}>
                  <input
                    type="checkbox"
                    checked={listingPrefs.pets?.includes(value) ?? false}
                    onChange={() => setPref({ pets: toggle(listingPrefs.pets, value) })}
                  />{' '}
                  {label}
                </label>
              ))}
              <label>
                <input type="checkbox" checked={!!listingPrefs.inUnitLaundry} onChange={(e) => setPref({ inUnitLaundry: e.target.checked })} /> In-unit laundry
              </label>
              <label>
                <input type="checkbox" checked={!!listingPrefs.parking} onChange={(e) => setPref({ parking: e.target.checked })} /> Parking
              </label>
            </div>
          </>
        ) : (
          <>
            <div className="match-finder-budget-row">
              <label htmlFor="max-hoa">Max HOA / mo</label>
              <input
                id="max-hoa"
                type="number"
                placeholder="No limit"
                min={0}
                step={25}
                value={listingPrefs.maxHoa ?? ''}
                onChange={(e) => setPref({ maxHoa: e.target.value === '' ? null : Number(e.target.value) })}
              />
            </div>
            <div className="match-finder-budget-row">
              <label htmlFor="min-built">Built after</label>
              <select
                id="min-built"
                value={listingPrefs.minYearBuilt ?? ''}
                onChange={(e) => setPref({ minYearBuilt: e.target.value === '' ? null : Number(e.target.value) })}
              >
                <option value="">Any</option>
                {[1950, 1980, 2000, 2010, 2020].map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
          </>
        )}
        <div style={{ fontSize: '11px', color: '#999', marginBottom: '6px' }}>
          Budget is checked against each area's Census median; home type also filters the buildings shown in each area; bedrooms, pets and amenities only apply to the Zillow links.
        </div>
        {excludedCount > 0 && (
          <div className="match-finder-excluded-note">
            {excludedCount} building{excludedCount === 1 ? '' : 's'} over budget, excluded from results.
          </div>
        )}
      </div>

      <div className="match-finder-section">
        <div className="match-finder-section-title">Commute</div>
        <WorkAddressInput />
        {work && (
          <div className="match-finder-budget-row" style={{ marginTop: '6px' }}>
            <label htmlFor="max-commute">Max est. drive</label>
            <select
              id="max-commute"
              value={maxCommuteMin ?? ''}
              onChange={(e) => setMaxCommuteMin(e.target.value === '' ? null : Number(e.target.value))}
            >
              <option value="">No limit</option>
              {[10, 15, 20, 30, 45].map((n) => (
                <option key={n} value={n}>{n} min</option>
              ))}
            </select>
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
          <div className="match-finder-no-results">No areas fit that budget{commuteLimit != null ? ' and commute' : ''}. Try raising your limits.</div>
        ) : null}
      </div>

      {weightsActive && regions.length > 0 && (
        <div className="match-finder-section">
          <div className="match-finder-section-title">Top 5 recommended areas</div>
          <ol className="match-finder-listings">
            {regionsWithHouses.map((region) => (
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
                      ({describeBuildings(region.buildings)} nearby
                      {work ? ` · ~${estimateCommute(region.center, work).driveMin} min drive` : ''})
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
