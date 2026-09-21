'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import NeighborhoodSidebar from '@/components/NeighborhoodSidebar';
import CompareSidebar from '@/components/CompareSidebar';
import AddressSearch from '@/components/AddressSearch';
import Legend from '@/components/Legend';
import ScoreSelector from '@/components/ScoreSelector';
import MatchFinder from '@/components/MatchFinder';
import type { Neighborhood } from '@/types/neighborhood';
import type { ScoreMetricKey, MatchWeights } from '@/lib/scoreMetric';
import { DEFAULT_MATCH_WEIGHTS, hasActiveWeights } from '@/lib/scoreMetric';
import type { ColorMetricKey } from '@/lib/colorMetric';
import type { MapClickMode, MapGranularity } from '@/components/NeighborhoodMap';
import { reverseGeocode, googleMapsSearchUrl, snapToNearestBuilding, findNearestNamedPlace, cityForDistrictId } from '@/lib/geo';
import { POINT_LAYER_LABELS } from '@/lib/pointLayerColors';
import { loadBudgetData, isWithinBudget } from '@/lib/budgetData';
import type { MatchRegion } from '@/lib/matchRegions';
import type { ApartmentBuildingPoint } from '@/components/NeighborhoodMap';
import type { LetterGrade } from '@/lib/letterGrade';

const NeighborhoodMap = dynamic(() => import('@/components/NeighborhoodMap'), {
  ssr: false,
  loading: () => <div>Loading map...</div>,
});

export default function Home() {
  const [selectedDistrict, setSelectedDistrict] = useState<Neighborhood | null>(null);
  const [flyToLocation, setFlyToLocation] = useState<{ lat: number; lon: number } | null>(null);
  const [searchMarker, setSearchMarker] = useState<{ lat: number; lon: number; label: string; isNamedPlace: boolean; address?: string } | null>(null);
  const [scoreMetric, setScoreMetric] = useState<ScoreMetricKey>('health_score');
  const [colorMetric, setColorMetric] = useState<ColorMetricKey | null>(null);
  const [hoveredGrade, setHoveredGrade] = useState<LetterGrade | null>(null);
  const [pinnedGrade, setPinnedGrade] = useState<LetterGrade | null>(null);
  const highlightedGrade = hoveredGrade ?? pinnedGrade;
  const [clickMode, setClickMode] = useState<MapClickMode>('district');
  const [granularity, setGranularity] = useState<MapGranularity>('district');
  const [hiddenSources, setHiddenSources] = useState<Set<string>>(
    () => new Set(Object.keys(POINT_LAYER_LABELS))
  );
  const [sidebarWidth, setSidebarWidth] = useState(320);
  const [isDraggingSidebar, setIsDraggingSidebar] = useState(false);
  const dragStateRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const [matchFinderOpen, setMatchFinderOpen] = useState(false);
  const [matchWeights, setMatchWeights] = useState<MatchWeights>({ ...DEFAULT_MATCH_WEIGHTS });
  const [maxRent, setMaxRent] = useState<number | null>(null);
  const [maxHomeValue, setMaxHomeValue] = useState<number | null>(null);
  const [budgetExcludedDistrictIds, setBudgetExcludedDistrictIds] = useState<Set<number> | null>(null);
  const [matchCityFilter, setMatchCityFilter] = useState<'all' | 'stpaul' | 'mpls'>('all');
  const [matchRegions, setMatchRegions] = useState<MatchRegion[]>([]);
  const [activeRegionId, setActiveRegionId] = useState<string | null>(null);
  const [apartmentBuildingsVisible, setApartmentBuildingsVisible] = useState(false);

  // Compare mode: once selectedDistrict is set, "Compare" arms picking a
  // second district/ZIP (via map click or search) of the SAME type
  // (district-vs-district or zip-vs-zip only — the two granularities are
  // normalized in separate pools, see NeighborhoodSidebar's comparisonPool
  // comment, so a district-vs-zip comparison wouldn't be on a shared scale).
  // Radius/place selections can't be compared since they have no stable
  // identity to diff against.
  const [compareArmed, setCompareArmed] = useState(false);
  const [compareDistrict, setCompareDistrict] = useState<Neighborhood | null>(null);

  const tryAddCompareDistrict = useCallback(
    (candidate: Neighborhood | null) => {
      if (!candidate || candidate.is_radius) return false;
      if (!selectedDistrict || selectedDistrict.is_radius) return false;
      if (!!candidate.is_zip !== !!selectedDistrict.is_zip) return false;
      if (candidate.district_id === selectedDistrict.district_id) return false;
      setCompareDistrict(candidate);
      setCompareArmed(false);
      return true;
    },
    [selectedDistrict]
  );

  const exitCompare = () => {
    setCompareArmed(false);
    setCompareDistrict(null);
  };

  // Closing Find Your Match should also clear the ranked-region recommendation
  // circles it drew on the map, not just hide the panel.
  const closeMatchFinder = () => {
    setMatchFinderOpen(false);
    setMatchRegions([]);
    setActiveRegionId(null);
    setMatchCityFilter('all');
  };

  // Recompute which districts exceed the budget filters whenever they change,
  // so the map can gray them out even while the Match Finder panel is closed.
  useEffect(() => {
    if (maxRent === null && maxHomeValue === null) {
      setBudgetExcludedDistrictIds(null);
      return;
    }
    let cancelled = false;
    loadBudgetData().then((budget) => {
      if (cancelled) return;
      const excluded = new Set<number>();
      for (const [idStr, info] of Object.entries(budget)) {
        if (!isWithinBudget(info, maxRent, maxHomeValue)) {
          excluded.add(Number(idStr));
        }
      }
      setBudgetExcludedDistrictIds(excluded);
    });
    return () => {
      cancelled = true;
    };
  }, [maxRent, maxHomeValue]);

  // Combine the budget-based exclusion set with the Find Your Match city
  // filter: picking St. Paul or Minneapolis dims out every district in the
  // other city on the map, same treatment as an over-budget district, so
  // the chosen city stands out clearly instead of both staying equally lit.
  const excludedDistrictIds = useMemo(() => {
    if (matchCityFilter === 'all') return budgetExcludedDistrictIds;
    const combined = new Set<number>(budgetExcludedDistrictIds ?? []);
    const allIds = [
      ...Array.from({ length: 17 }, (_, i) => i + 1),
      ...Array.from({ length: 11 }, (_, i) => i + 101),
    ];
    for (const id of allIds) {
      if (cityForDistrictId(id) !== matchCityFilter) combined.add(id);
    }
    return combined;
  }, [budgetExcludedDistrictIds, matchCityFilter]);

  const MIN_SIDEBAR_WIDTH = 260;
  const MAX_SIDEBAR_WIDTH = 800;

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragStateRef.current = { startX: e.clientX, startWidth: sidebarWidth };
      setIsDraggingSidebar(true);

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!dragStateRef.current) return;
        // Sidebar is on the right, so dragging left (negative delta) widens it.
        const delta = dragStateRef.current.startX - moveEvent.clientX;
        const newWidth = Math.min(
          MAX_SIDEBAR_WIDTH,
          Math.max(MIN_SIDEBAR_WIDTH, dragStateRef.current.startWidth + delta)
        );
        setSidebarWidth(newWidth);
      };

      const handleMouseUp = () => {
        dragStateRef.current = null;
        setIsDraggingSidebar(false);
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    },
    [sidebarWidth]
  );

  // Grocery stores and restaurants/bars are the two point layers most
  // relevant to "what's near this place" — auto-reveal them (without
  // touching any other layer the user has toggled) whenever a place gets
  // selected, so results show up without digging into the layer control.
  // Only the ones this actually turned on (not ones already visible) are
  // remembered, so deselecting the place can hide them again symmetrically
  // instead of leaving them on — and re-checking the box after that isn't
  // fighting a reveal that silently re-fires on the next render.
  const autoRevealedSourcesRef = useRef<Set<string>>(new Set());
  // Sources the user has explicitly checked/unchecked themselves — once a
  // layer is here, auto-reveal must leave it alone so it doesn't override a
  // deliberate uncheck the next time a place gets selected.
  const userOverriddenSourcesRef = useRef<Set<string>>(new Set());

  const revealNearbyLayers = () => {
    setHiddenSources((prev) => {
      const toReveal = ['groceries', 'restaurants', 'entertainment'].filter(
        (s) => prev.has(s) && !userOverriddenSourcesRef.current.has(s)
      );
      if (toReveal.length === 0) return prev;
      autoRevealedSourcesRef.current = new Set(toReveal);
      const next = new Set(prev);
      toReveal.forEach((s) => next.delete(s));
      return next;
    });
  };

  const hideAutoRevealedLayers = () => {
    if (autoRevealedSourcesRef.current.size === 0) return;
    const toHide = autoRevealedSourcesRef.current;
    autoRevealedSourcesRef.current = new Set();
    setHiddenSources((prev) => {
      const next = new Set(prev);
      toHide.forEach((s) => next.add(s));
      return next;
    });
  };

  const deselectPlace = () => {
    setSearchMarker(null);
    setSelectedDistrict(null);
    exitCompare();
    hideAutoRevealedLayers();
  };

  // Clicking a Component Score card (Safety & Health, Amenities & Services,
  // Transportation) in the sidebar auto-reveals the point layers that feed
  // that component, so you can see what's actually nearby without digging
  // into the layer checkboxes yourself. Opportunity and Economic Profile
  // have no map point layers (permits/unemployment/Census figures aren't
  // plotted), so they reveal nothing. Mirrors the groceries/restaurants
  // auto-reveal pattern above: only layers this turned on get remembered,
  // so switching to a different component (or closing the panel) hides
  // exactly what it revealed rather than fighting a manual toggle.
  const COMPONENT_LAYER_SOURCES: Record<string, string[]> = {
    safety: ['crime', 'crashes'],
    amenities: ['schools', 'groceries', 'restaurants', 'healthcare', 'entertainment'],
    transportation: ['transit', 'trails'],
  };
  const componentRevealedSourcesRef = useRef<Set<string>>(new Set());

  const handleExpandedIndexChange = (key: string | null) => {
    setHiddenSources((prev) => {
      const next = new Set(prev);
      // Always undo whatever the previously-expanded component revealed
      // first, so switching straight from one component to another doesn't
      // leave the old one's layers stuck on.
      if (componentRevealedSourcesRef.current.size > 0) {
        componentRevealedSourcesRef.current.forEach((s) => next.add(s));
        componentRevealedSourcesRef.current = new Set();
      }
      const toReveal = (key ? COMPONENT_LAYER_SOURCES[key] || [] : []).filter(
        (s) => next.has(s) && !userOverriddenSourcesRef.current.has(s)
      );
      toReveal.forEach((s) => next.delete(s));
      componentRevealedSourcesRef.current = new Set(toReveal);
      return next;
    });
  };

  const handleDistrictSelect = (district: Neighborhood | null) => {
    if (compareArmed && tryAddCompareDistrict(district)) return;
    setSelectedDistrict(district);
    setCompareDistrict(null);
  };

  const handleAddressSelect = (
    address: string,
    lat: number,
    lon: number,
    district: Neighborhood | null,
    label: string,
    isNamedPlace: boolean
  ) => {
    if (compareArmed && tryAddCompareDistrict(district)) return;
    // Shown briefly until NeighborhoodMap's radius-score effect reports the
    // computed 1-mile-radius result for this same searchMarker.
    setSelectedDistrict(district);
    setCompareDistrict(null);
    setFlyToLocation({ lat, lon });
    setSearchMarker({ lat, lon, label, isNamedPlace, address });
    revealNearbyLayers();
  };

  const handleMapClick = async (lat: number, lon: number) => {
    // Clicking back near the currently-selected place deselects it instead
    // of re-searching — mirrors the toggle-off behavior district mode
    // already has when you click the same district twice.
    if (searchMarker) {
      const dLat = (lat - searchMarker.lat) * 111320;
      const dLon = (lon - searchMarker.lon) * 111320 * Math.cos((lat * Math.PI) / 180);
      const distanceMeters = Math.sqrt(dLat * dLat + dLon * dLon);
      if (distanceMeters <= 60) {
        deselectPlace();
        return;
      }
    }

    // Drop the marker immediately at the raw click point so it appears
    // instantly, then refine it in place once the building-snap and
    // reverse-geocode calls (run in parallel, not sequentially) resolve.
    setSearchMarker({ lat, lon, label: 'Loading…', isNamedPlace: false });
    revealNearbyLayers();
    // Resolve the snap and the label independently — waiting on both via
    // Promise.all made the label sit at "Loading…" until the slower of the
    // two (usually the Overpass building-snap query) finished, even though
    // the label only depends on the Nominatim reverse-geocode call.
    // The building-snap (Overpass) and named-place (local index) lookups
    // race independently and both want to move the marker. Without
    // coordination, whichever happens to resolve LAST wins — so a
    // fast-resolving named-place match could get silently overwritten by a
    // slower snap call falling back to the raw click point, making the
    // final marker position (and therefore the 1-mile-radius score) depend
    // on network timing instead of the click itself. Once a named place has
    // been applied, the snap is purely geometric and shouldn't clobber it.
    let namedPlaceApplied = false;
    let snappedPos = { lat, lon };
    snapToNearestBuilding(lat, lon).then((snapped) => {
      snappedPos = snapped;
      if (namedPlaceApplied) return;
      setSearchMarker((prev) => (prev ? { ...prev, lat: snapped.lat, lon: snapped.lon } : prev));
    });
    // Prefer a nearby named building/POI (checked across name, addr:housename,
    // and operator tags) over Nominatim's reverse geocode, which only reads
    // `name` and falls back to the bare street address for the many buildings
    // that don't carry that specific tag.
    findNearestNamedPlace(lat, lon).then((named) => {
      if (named) {
        namedPlaceApplied = true;
        setSearchMarker((prev) => (prev ? { lat: named.lat, lon: named.lon, label: named.name, isNamedPlace: true, address: prev.address } : prev));
      }
    });
    reverseGeocode(lat, lon).then(({ label, isNamedPlace, address }) => {
      setSearchMarker((prev) => (prev && prev.label === 'Loading…' ? { ...snappedPos, label, isNamedPlace, address } : prev ? { ...prev, address } : prev));
    });
  };

  // Picking one of "Find Your Match"'s top-5 recommended areas flies the map
  // to that district's recommendation radius (drawn by NeighborhoodMap from
  // matchRegions) and reveals the apartment buildings inside it as clickable
  // markers — the region itself is the recommendation, not any one building.
  const handleSelectRegion = (region: MatchRegion) => {
    setActiveRegionId(region.id);
    setFlyToLocation(region.center);
  };

  // Clicking an apartment-building dot (the always-on layer, or one inside
  // an active Find Your Match region) shows it via the same place-mode
  // search-pin flow as an address search (marker, 1-mile radius circle,
  // nearby grocery/restaurant layers) — its score is computed live by
  // NeighborhoodMap's radius-score effect rather than reused from any match
  // ranking, same as any other map click.
  const handleSelectApartmentBuilding = (building: ApartmentBuildingPoint) => {
    setFlyToLocation({ lat: building.lat, lon: building.lon });
    setSearchMarker({
      lat: building.lat,
      lon: building.lon,
      label: building.name,
      isNamedPlace: true,
      address: building.address ?? undefined,
    });
    revealNearbyLayers();
  };

  return (
    <div className="container">
      <div className="map-container">
        <NeighborhoodMap
          onDistrictSelect={handleDistrictSelect}
          selectedDistrict={selectedDistrict}
          compareDistrict={compareDistrict}
          flyToLocation={flyToLocation}
          searchMarker={searchMarker}
          onClearSearchMarker={deselectPlace}
          onMapClick={handleMapClick}
          clickMode={clickMode}
          scoreMetric={scoreMetric}
          colorMetric={colorMetric}
          onPlaceScoreComputed={setSelectedDistrict}
          hiddenSources={hiddenSources}
          matchWeights={matchFinderOpen && hasActiveWeights(matchWeights) ? matchWeights : null}
          excludedDistrictIds={excludedDistrictIds}
          granularity={granularity}
          matchRegions={matchRegions}
          activeRegionId={activeRegionId}
          onSelectRegion={handleSelectRegion}
          apartmentBuildingsVisible={apartmentBuildingsVisible}
          onSelectApartmentBuilding={handleSelectApartmentBuilding}
          highlightedGrade={highlightedGrade}
        />
        <Legend
          scoreMetric={scoreMetric}
          colorMetric={colorMetric}
          hiddenSources={hiddenSources}
          onHoverGrade={setHoveredGrade}
          pinnedGrade={pinnedGrade}
          onClickGrade={(grade) => setPinnedGrade((prev) => (prev === grade ? null : grade))}
          onToggleSource={(key) => {
            // A manual toggle overrides the auto-reveal bookkeeping so
            // deselecting the place later doesn't fight the user's own choice.
            autoRevealedSourcesRef.current.delete(key);
            componentRevealedSourcesRef.current.delete(key);
            userOverriddenSourcesRef.current.add(key);
            setHiddenSources((prev) => {
              const next = new Set(prev);
              if (next.has(key)) next.delete(key);
              else next.add(key);
              return next;
            });
          }}
          onDeselectAll={(allKeys) => {
            autoRevealedSourcesRef.current = new Set();
            componentRevealedSourcesRef.current = new Set();
            userOverriddenSourcesRef.current = new Set();
            setHiddenSources(new Set(allKeys));
            setApartmentBuildingsVisible(false);
          }}
          apartmentBuildingsVisible={apartmentBuildingsVisible}
          onToggleApartmentBuildings={() => setApartmentBuildingsVisible((v) => !v)}
        />
        <div className={`map-controls-stack${matchFinderOpen ? ' match-finder-active' : ''}`}>
          {!matchFinderOpen && (
            <>
              <AddressSearch onAddressSelect={handleAddressSelect} />
              <ScoreSelector value={scoreMetric} onChange={setScoreMetric} colorMetric={colorMetric} onColorMetricChange={setColorMetric} />
              <div className="click-mode-toggle">
                <div className="click-mode-toggle-row">
                  <span className="click-mode-toggle-label">Map view:</span>
                  <div className="click-mode-toggle-buttons">
                    <button
                      type="button"
                      className={granularity === 'district' ? 'active' : ''}
                      onClick={() => {
                        setGranularity('district');
                        setSelectedDistrict(null);
                      }}
                    >
                      District
                    </button>
                    <button
                      type="button"
                      className={granularity === 'zip' ? 'active' : ''}
                      onClick={() => {
                        setGranularity('zip');
                        setSelectedDistrict(null);
                      }}
                    >
                      ZIP Code
                    </button>
                  </div>
                </div>
                <div className="click-mode-toggle-row">
                  <span className="click-mode-toggle-label">Clicking the map selects:</span>
                  <div className="click-mode-toggle-buttons">
                    <button
                      type="button"
                      className={clickMode === 'district' ? 'active' : ''}
                      onClick={() => setClickMode('district')}
                    >
                      {granularity === 'zip' ? 'ZIP Code' : 'District'}
                    </button>
                    <button
                      type="button"
                      className={clickMode === 'place' ? 'active' : ''}
                      onClick={() => setClickMode('place')}
                    >
                      Place
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}
          <button
            type="button"
            className="match-finder-toggle"
            onClick={() => {
              if (matchFinderOpen) {
                closeMatchFinder();
              } else {
                setMatchFinderOpen(true);
              }
            }}
          >
            {matchFinderOpen ? 'Close Find Your Match' : '🔍 Find Your Match'}
          </button>
          {matchFinderOpen && (
            <MatchFinder
              weights={matchWeights}
              onWeightsChange={setMatchWeights}
              maxRent={maxRent}
              onMaxRentChange={setMaxRent}
              maxHomeValue={maxHomeValue}
              onMaxHomeValueChange={setMaxHomeValue}
              cityFilter={matchCityFilter}
              onCityFilterChange={setMatchCityFilter}
              onRegionsChange={setMatchRegions}
              activeRegionId={activeRegionId}
              onSelectRegion={handleSelectRegion}
              onClose={closeMatchFinder}
            />
          )}
          {(searchMarker || selectedDistrict) && (
            <div className="selected-place">
              {searchMarker && <span className="selected-place-name">{searchMarker.label}</span>}
              {!searchMarker && selectedDistrict && (
                <span className="selected-place-name">{selectedDistrict.district_name}</span>
              )}
              {compareDistrict && (
                <span className="selected-place-name" style={{ color: '#e6550d' }}>vs {compareDistrict.district_name}</span>
              )}
              {selectedDistrict && !selectedDistrict.is_radius && !compareDistrict && (
                <button
                  type="button"
                  className="deselect-marker-button"
                  onClick={() => setCompareArmed((v) => !v)}
                  style={compareArmed ? { background: '#e6550d', color: 'white' } : undefined}
                >
                  {compareArmed
                    ? `Click another ${selectedDistrict.is_zip ? 'ZIP' : 'district'}…`
                    : 'Compare'}
                </button>
              )}
              {compareDistrict && (
                <button type="button" className="deselect-marker-button" onClick={exitCompare}>
                  Exit compare
                </button>
              )}
              <button
                type="button"
                className="deselect-marker-button"
                onClick={deselectPlace}
              >
                Deselect all
              </button>
            </div>
          )}
        </div>
        <div
          style={{
            position: 'absolute',
            bottom: '10px',
            right: '10px',
            zIndex: 1000,
            display: 'flex',
            gap: '12px',
            background: 'white',
            padding: '8px 12px',
            borderRadius: '8px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
            fontSize: '14px',
          }}
        >
          <Link href="/trends" style={{ color: '#756bb1', fontWeight: 600 }}>Trends</Link>
          <Link href="/about" style={{ color: '#756bb1', fontWeight: 600 }}>About</Link>
        </div>
      </div>
      <div className="sidebar-wrapper" style={{ width: sidebarWidth }}>
        <div
          className={`sidebar-resize-handle${isDraggingSidebar ? ' dragging' : ''}`}
          onMouseDown={handleResizeStart}
        />
        <div className="hero-banner">
          <div className="hero-title">Twin Cities Living Quality Map</div>
          <div className="hero-subtitle">
            Safety, economic profile, transportation, amenities &amp; opportunity:{' '}
            <span className="hero-callout">search any address for its 1-mile radius score.</span>
          </div>
        </div>
        {compareDistrict && selectedDistrict ? (
          <CompareSidebar
            districtA={selectedDistrict}
            districtB={compareDistrict}
            onClose={exitCompare}
          />
        ) : (
          <NeighborhoodSidebar
            district={selectedDistrict}
            onSelectDistrict={handleDistrictSelect}
            granularity={granularity}
            scoreMetric={scoreMetric}
            colorMetric={colorMetric}
            reviewsUrl={
              searchMarker
                ? googleMapsSearchUrl(searchMarker.lat, searchMarker.lon, searchMarker.isNamedPlace ? searchMarker.label : undefined)
                : null
            }
            reviewsLinkIsNamedPlace={searchMarker?.isNamedPlace ?? false}
            onExpandedIndexChange={handleExpandedIndexChange}
          />
        )}
      </div>
    </div>
  );
}
