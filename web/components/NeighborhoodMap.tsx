'use client';

import { useEffect, useRef, useState } from 'react';
import { MapContainer, TileLayer, GeoJSON, useMap } from 'react-leaflet';
import L from 'leaflet';
import { percentileRank, getLetterGrade, gradeColor, LetterGrade } from '@/lib/letterGrade';
import { loadNeighborhoodData, getNeighborhoodMap } from '@/lib/loadNeighborhoodData';
import { POINT_LAYER_COLORS, POINT_LAYER_LABELS, POINT_LAYER_ICONS, CANVAS_MARKER_THRESHOLD } from '@/lib/pointLayerColors';
import { resolveScore, ScoreMetricKey, MatchWeights } from '@/lib/scoreMetric';
import { findDistrictForPoint, cityForDistrictId, resolveNeighborhoodForPoint } from '@/lib/geo';
import {
  computeRadiusNeighborhood,
  RadiusBaseline,
  TractAffordabilityRow,
  PointEntry,
  TrailEntry,
} from '@/lib/radiusScore';
import type { MatchRegion } from '@/lib/matchRegions';

const MATCH_REGION_COLORS = ['#e31a1c', '#ff7f00', '#33a02c', '#1f78b4', '#6a3d9a'];

function makeRegionCenterIcon(rank: number, color: string, active: boolean): L.DivIcon {
  const size = active ? 34 : 26;
  return L.divIcon({
    className: 'match-region-center-icon',
    html: `<div style="background:${color};color:white;width:${size}px;height:${size}px;border-radius:50%;border:${active ? 3 : 2}px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:${active ? 15 : 13}px;">${rank}</div>`,
    iconSize: [size, size],
  });
}

// Raw shape of web/public/data/apartment_buildings_{city}.json (see
// pipeline/build.py's build_apartment_buildings()) — only the fields this
// always-on map layer needs.
export interface ApartmentBuildingPoint {
  id: string;
  name: string;
  address: string | null;
  lat: number;
  lon: number;
  district_id: number;
}

function makeMarkerIcon(color: string, emoji: string): L.DivIcon {
  return L.divIcon({
    className: 'point-marker-icon',
    html: `<div style="background:${color};width:22px;height:22px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:1.5px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;"><span style="transform:rotate(45deg);font-size:12px;line-height:1;">${emoji}</span></div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 22],
    popupAnchor: [0, -20],
  });
}

// Markers only bundle into a cluster bubble when a local area (a fixed-size
// pixel cell at the current zoom) actually has more than this many markers
// in it — otherwise every marker renders individually, even if several are
// close together. Recomputed on zoom change since pixel distance between
// two fixed points grows as you zoom in, naturally splitting clusters apart.
const CLUSTER_MIN_COUNT = 50;
const CLUSTER_CELL_PX = 60;

// Layers with more points than CANVAS_MARKER_THRESHOLD render as canvas
// circle markers instead of DOM divIcon markers. A divIcon is a real DOM node
// that the browser has to paint/composite on every pan frame; at a few
// hundred that's invisible, but a high-volume layer (thousands of crime
// points, transit stops, etc.) makes dragging the map visibly stutter.
// Canvas markers are pixels on one shared <canvas> element, so panning stays
// cheap regardless of count.

function makeClusterIcon(count: number): L.DivIcon {
  const size = count > 200 ? 46 : count > 100 ? 40 : 34;
  return L.divIcon({
    className: 'point-cluster-icon',
    html: `<div style="background:#555;color:white;width:${size}px;height:${size}px;border-radius:50%;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;font-weight:600;font-size:12px;">${count}</div>`,
    iconSize: [size, size],
  });
}

type PointMarker = L.Marker | L.CircleMarker;

// Toggling display via the marker's existing DOM element is far cheaper than
// removing/re-adding the marker to its layer group: Leaflet rebuilds the icon
// element from scratch (_initIcon) on every add, which is what caused the lag
// when selecting through a high-volume layer. getElement() is undefined until
// the marker's group has actually been added to the map, in which case there
// is nothing to hide yet. Canvas circle markers have no DOM element per
// marker to toggle — visibility for those is handled by add/remove instead
// (see renderAllLabels), which is cheap for canvas layers since there's no
// icon to rebuild.
function setMarkerVisible(marker: PointMarker, visible: boolean) {
  if (!(marker instanceof L.Marker)) return;
  const el = marker.getElement();
  if (el) el.style.display = visible ? '' : 'none';
}

function computeClusters(
  map: L.Map,
  entries: { marker: PointMarker; districtId: number | null }[]
): {
  individual: Set<PointMarker>;
  clusters: { avgLat: number; avgLng: number; count: number; bounds: L.LatLngBounds }[];
} {
  const zoom = map.getZoom();
  const cells = new Map<string, { marker: PointMarker; districtId: number | null }[]>();
  for (const entry of entries) {
    const pt = map.project(entry.marker.getLatLng(), zoom);
    const key = `${Math.floor(pt.x / CLUSTER_CELL_PX)}:${Math.floor(pt.y / CLUSTER_CELL_PX)}`;
    let cell = cells.get(key);
    if (!cell) {
      cell = [];
      cells.set(key, cell);
    }
    cell.push(entry);
  }

  const individual = new Set<PointMarker>();
  const clusters: { avgLat: number; avgLng: number; count: number; bounds: L.LatLngBounds }[] = [];
  for (const group of cells.values()) {
    if (group.length > CLUSTER_MIN_COUNT) {
      const latlngs = group.map((g) => g.marker.getLatLng());
      const avgLat = latlngs.reduce((s, l) => s + l.lat, 0) / latlngs.length;
      const avgLng = latlngs.reduce((s, l) => s + l.lng, 0) / latlngs.length;
      clusters.push({ avgLat, avgLng, count: group.length, bounds: L.latLngBounds(latlngs) });
    } else {
      for (const entry of group) individual.add(entry.marker);
    }
  }
  return { individual, clusters };
}
import type { Neighborhood } from '@/types/neighborhood';
import 'leaflet/dist/leaflet.css';

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const POINT_LAYER_FILES: { key: string; url: string }[] = [
  { key: 'points_stpaul', url: '/data/points_stpaul.json' },
  { key: 'points_mpls', url: '/data/points_mpls.json' },
  // Points that fell outside every district polygon in both cities (a
  // boundary sliver, a neighboring suburb) — still real and still within
  // reach of a 1-mile radius search near a city edge, so they're rendered
  // and counted too, just with no district assignment.
  { key: 'points_unassigned', url: '/data/points_unassigned.json' },
  { key: 'lines_trails', url: '/data/lines_trails.json' },
];

export type MapClickMode = 'district' | 'place';
export type MapGranularity = 'district' | 'zip';

interface NeighborhoodMapProps {
  onDistrictSelect: (district: Neighborhood | null) => void;
  selectedDistrict: Neighborhood | null;
  flyToLocation?: { lat: number; lon: number } | null;
  searchMarker?: { lat: number; lon: number; label: string; address?: string } | null;
  onClearSearchMarker?: () => void;
  onMapClick?: (lat: number, lon: number) => void;
  clickMode?: MapClickMode;
  scoreMetric?: ScoreMetricKey;
  onPlaceScoreComputed?: (neighborhood: Neighborhood) => void;
  hiddenSources?: Set<string>;
  matchWeights?: MatchWeights | null;
  excludedDistrictIds?: Set<number> | null;
  granularity?: MapGranularity;
  matchRegions?: MatchRegion[] | null;
  activeRegionId?: string | null;
  onSelectRegion?: (region: MatchRegion) => void;
  // Apartment-building dots are an always-available map layer (toggled from
  // the legend like any other Data Points source), independent of whether
  // "Find Your Match" is open — see NeighborhoodMap's apartment-layer effect.
  apartmentBuildingsVisible?: boolean;
  onSelectApartmentBuilding?: (building: ApartmentBuildingPoint) => void;
  // Set while the user hovers a letter grade in the legend's scale strip —
  // districts matching that grade get emphasized and all others dimmed.
  highlightedGrade?: LetterGrade | null;
}

function makeSearchMarkerIcon(): L.DivIcon {
  return L.divIcon({
    className: 'search-marker-icon',
    html: `<div style="background:#e31a1c;width:26px;height:26px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:2px solid white;box-shadow:0 2px 5px rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;"><span style="transform:rotate(45deg);font-size:14px;line-height:1;">📍</span></div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 26],
    popupAnchor: [0, -24],
  });
}

function MapContent({
  onDistrictSelect,
  selectedDistrict,
  flyToLocation,
  searchMarker,
  onClearSearchMarker,
  onMapClick,
  clickMode = 'district',
  scoreMetric = 'health_score',
  onPlaceScoreComputed,
  hiddenSources,
  matchWeights = null,
  excludedDistrictIds = null,
  granularity = 'district',
  matchRegions = null,
  activeRegionId = null,
  onSelectRegion,
  apartmentBuildingsVisible = false,
  onSelectApartmentBuilding,
  highlightedGrade = null,
}: NeighborhoodMapProps) {
  const map = useMap();
  const radiusBaselineRef = useRef<Record<'stpaul' | 'mpls', RadiusBaseline | null>>({ stpaul: null, mpls: null });
  const tractsAffordabilityRef = useRef<Record<'stpaul' | 'mpls', TractAffordabilityRow[]>>({ stpaul: [], mpls: [] });
  const onPlaceScoreComputedRef = useRef(onPlaceScoreComputed);
  onPlaceScoreComputedRef.current = onPlaceScoreComputed;
  // Two independent normalization pools: "district" (St. Paul + Minneapolis
  // boundaries, pooled together — see health_score.py's
  // compute_health_scores_combined) and "zip" (every ZIP in the metro,
  // pooled separately — compute_health_scores_zip). Each pool gets its own
  // color-scale min/max, since they're normalized independently on the
  // backend too. Only one pool's layers are ever attached to the map at a
  // time, toggled by the granularity prop (see applyGranularityVisibility).
  const layerPoolsRef = useRef<
    { kind: MapGranularity; entries: { layer: L.GeoJSON; neighborhoodMap: Map<number, Neighborhood> }[] }[]
  >([]);
  const granularityRef = useRef<MapGranularity>(granularity);
  const searchMarkerRef = useRef<L.Marker | null>(null);
  const searchRadiusCircleRef = useRef<L.Circle | null>(null);
  const regionCircleLayerRef = useRef<L.LayerGroup | null>(null);
  const onSelectRegionRef = useRef(onSelectRegion);
  onSelectRegionRef.current = onSelectRegion;
  const apartmentBuildingsDataRef = useRef<ApartmentBuildingPoint[] | null>(null);
  const apartmentLayerGroupRef = useRef<L.LayerGroup | null>(null);
  const onSelectApartmentBuildingRef = useRef(onSelectApartmentBuilding);
  onSelectApartmentBuildingRef.current = onSelectApartmentBuilding;
  // All markers per label, keyed by point-layer label (e.g. "Transit
  // Stops"). Never added to the map directly — renderLabel() decides, per
  // zoom level and current filter, which subset gets grouped into cluster
  // bubbles vs. shown individually, and populates labelGroupsRef[label].
  const labelEntriesRef = useRef<Record<string, { marker: PointMarker; districtId: number | null; source: string }[]>>({});
  const labelGroupsRef = useRef<Record<string, L.LayerGroup>>({});
  // Synthetic cluster-bubble markers currently added per label, so
  // renderAllLabels() can remove just these (cheap) instead of clearing and
  // rebuilding the whole group's markers on every filter change.
  const clusterMarkersRef = useRef<Record<string, L.Marker[]>>({});
  // Canvas circle markers currently added to the map per label (individual,
  // non-clustered). Canvas markers have no display style to toggle, so
  // visibility is tracked here and applied via incremental add/remove —
  // cheap for canvas layers since there's no DOM icon to rebuild.
  const canvasMarkersShownRef = useRef<Record<string, Set<L.CircleMarker>>>({});
  const canvasRendererRef = useRef<L.Canvas | null>(null);
  // Trail/path segments: kept separately from point markers since they're
  // polylines (no single lat/lon) and never carry a district_id, so they're
  // filtered purely by "does any vertex fall within the search radius".
  const trailEntriesRef = useRef<{ layer: L.Layer; latlngs: L.LatLng[]; source: string }[]>([]);
  const trailGroupRef = useRef<L.LayerGroup | null>(null);
  const selectedDistrictRef = useRef<Neighborhood | null>(selectedDistrict);
  const searchMarkerPropRef = useRef<{ lat: number; lon: number; label: string; address?: string } | null | undefined>(searchMarker);
  const hiddenSourcesRef = useRef<Set<string>>(hiddenSources ?? new Set());
  const clickModeRef = useRef<MapClickMode>(clickMode);
  const onMapClickRef = useRef(onMapClick);
  onMapClickRef.current = onMapClick;
  const onClearSearchMarkerRef = useRef(onClearSearchMarker);
  onClearSearchMarkerRef.current = onClearSearchMarker;
  const neighborhoodMapsRef = useRef<Map<number, Neighborhood>[]>([]);
  const scoreMetricRef = useRef<ScoreMetricKey>(scoreMetric);
  const matchWeightsRef = useRef<MatchWeights | null>(matchWeights);
  const excludedDistrictIdsRef = useRef<Set<number> | null>(excludedDistrictIds);
  const districtBoundsRef = useRef<Record<number, L.LatLngBounds>>({});
  const [isLoading, setIsLoading] = useState(true);

  const isEntryVisible = (entry: { marker: PointMarker; districtId: number | null; source: string }) => {
    if (hiddenSourcesRef.current.has(entry.source)) return false;
    const sm = searchMarkerPropRef.current;
    if (sm) {
      const searchLatLng = L.latLng(sm.lat, sm.lon);
      return entry.marker.getLatLng().distanceTo(searchLatLng) <= 1609.34; // 1 mile
    }
    return true;
  };

  const renderAllLabels = () => {
    for (const label of Object.keys(labelEntriesRef.current)) {
      const group = labelGroupsRef.current[label];
      if (!group) continue;
      const allEntries = labelEntriesRef.current[label];
      const visible = allEntries.filter(isEntryVisible);
      const { individual, clusters } = computeClusters(map, visible);

      const currentCanvasShown = canvasMarkersShownRef.current[label] || new Set<L.CircleMarker>();
      const nextCanvasShown = new Set<L.CircleMarker>();
      for (const entry of allEntries) {
        const show = individual.has(entry.marker);
        if (entry.marker instanceof L.Marker) {
          setMarkerVisible(entry.marker, show);
        } else if (show) {
          nextCanvasShown.add(entry.marker);
          if (!currentCanvasShown.has(entry.marker)) group.addLayer(entry.marker);
        }
      }
      for (const cm of currentCanvasShown) {
        if (!nextCanvasShown.has(cm)) group.removeLayer(cm);
      }
      canvasMarkersShownRef.current[label] = nextCanvasShown;

      const oldClusterMarkers = clusterMarkersRef.current[label] || [];
      for (const clusterMarker of oldClusterMarkers) group.removeLayer(clusterMarker);

      const newClusterMarkers: L.Marker[] = [];
      for (const cluster of clusters) {
        const clusterMarker = L.marker([cluster.avgLat, cluster.avgLng], {
          icon: makeClusterIcon(cluster.count),
        });
        clusterMarker.on('click', () => map.fitBounds(cluster.bounds.pad(0.3)));
        group.addLayer(clusterMarker);
        newClusterMarkers.push(clusterMarker);
      }
      clusterMarkersRef.current[label] = newClusterMarkers;
    }
  };

  // Trails are radius-filtered when a place is selected (search or map
  // click); otherwise every trail is shown (subject to hiddenSources).
  const renderTrails = () => {
    const group = trailGroupRef.current;
    if (!group) return;
    group.clearLayers();
    const sm = searchMarkerPropRef.current;
    for (const entry of trailEntriesRef.current) {
      if (hiddenSourcesRef.current.has(entry.source)) continue;
      if (sm) {
        const searchLatLng = L.latLng(sm.lat, sm.lon);
        const withinRadius = entry.latlngs.some((ll) => ll.distanceTo(searchLatLng) <= 1609.34);
        if (!withinRadius) continue;
      }
      group.addLayer(entry.layer);
    }
  };

  useEffect(() => {
    selectedDistrictRef.current = selectedDistrict;
    renderAllLabels();
    renderTrails();
    if (selectedDistrict) {
      const bounds = districtBoundsRef.current[selectedDistrict.district_id];
      if (bounds) {
        map.flyToBounds(bounds, { padding: [80, 80] });
      }
    }
  }, [selectedDistrict]);

  useEffect(() => {
    searchMarkerPropRef.current = searchMarker;
    renderAllLabels();
    renderTrails();
  }, [searchMarker]);

  useEffect(() => {
    scoreMetricRef.current = scoreMetric;
  }, [scoreMetric]);

  useEffect(() => {
    matchWeightsRef.current = matchWeights;
  }, [matchWeights]);

  useEffect(() => {
    excludedDistrictIdsRef.current = excludedDistrictIds;
  }, [excludedDistrictIds]);

  useEffect(() => {
    hiddenSourcesRef.current = hiddenSources ?? new Set();
    renderAllLabels();
    renderTrails();
  }, [hiddenSources]);

  useEffect(() => {
    clickModeRef.current = clickMode;
  }, [clickMode]);

  // Show only the layers for the active granularity (district boundaries vs.
  // ZIP boundaries) — both pools are built once up front (see the main load
  // effect below) and kept off the map until selected, so switching back and
  // forth doesn't refetch anything.
  const applyGranularityVisibility = () => {
    for (const pool of layerPoolsRef.current) {
      const shouldShow = pool.kind === granularityRef.current;
      for (const { layer } of pool.entries) {
        const isOnMap = map.hasLayer(layer);
        if (shouldShow && !isOnMap) layer.addTo(map);
        else if (!shouldShow && isOnMap) map.removeLayer(layer);
      }
    }
  };

  useEffect(() => {
    granularityRef.current = granularity;
    applyGranularityVisibility();
  }, [granularity]);

  useEffect(() => {
    const onZoomEnd = () => renderAllLabels();
    map.on('zoomend', onZoomEnd);
    return () => {
      map.off('zoomend', onZoomEnd);
    };
  }, [map]);

  // Clicking anywhere on the map (including on a district polygon, or a
  // building/point within it) drops a search-style pin at that spot — same
  // marker, 1-mile radius, and nearby-groceries behavior as an address
  // search — so a click stands in for "search this place".
  //
  // District-mode selection is normally handled by each polygon's own
  // layer.on('click', ...) below. But a high-volume point layer renders as
  // canvas markers in 'markerPane' (above the polygons) so those markers stay
  // clickable — and since a canvas element is one solid rectangle covering
  // the whole view, it becomes the actual native click target everywhere,
  // not just where a marker is drawn. When it doesn't hit a marker, Leaflet
  // falls back to firing the map's own click event rather than the polygon
  // underneath. So district selection also needs this map-level fallback,
  // using the same point-in-polygon lookup 'place' mode already relies on.
  useEffect(() => {
    const onClick = (e: L.LeafletMouseEvent) => {
      const mode = clickModeRef.current;
      // A click that landed on the existing search pin means "deselect" — the
      // marker's own handler does that. Never treat it as a request to drop a
      // new pin, even if the event still reaches the map.
      const target = e.originalEvent?.target as Node | null;
      const markerEl = searchMarkerRef.current?.getElement();
      if (target && markerEl && markerEl.contains(target)) return;
      if (mode === 'place') {
        onMapClick?.(e.latlng.lat, e.latlng.lng);
        return;
      }
      // Only resolves against district boundaries — a click that misses
      // every polygon's own handler (e.g. a canvas marker layer stealing the
      // click) in ZIP granularity just falls through unhandled rather than
      // incorrectly selecting a district while viewing the ZIP layer.
      if (mode === 'district' && granularityRef.current === 'district') {
        resolveNeighborhoodForPoint(e.latlng.lat, e.latlng.lng).then((neighborhood) => {
          if (!neighborhood) return;
          const isCurrentlySelected = selectedDistrictRef.current?.district_id === neighborhood.district_id;
          onDistrictSelect(isCurrentlySelected ? null : neighborhood);
        });
      }
    };
    map.on('click', onClick);
    return () => {
      map.off('click', onClick);
    };
  }, [map, onMapClick, onDistrictSelect]);

  // District name labels are permanent tooltips. At the map's fully-zoomed-
  // out view (minZoom, 11) all 28 districts' labels — several multi-word —
  // are visible at once, so they're shrunk down there instead of hidden,
  // then step up in size at the next two zoom levels (12, 13) before
  // reaching full size once zoomed in enough that labels have their own room.
  useEffect(() => {
    const updateLabelVisibility = () => {
      const zoom = map.getZoom();
      const container = map.getContainer();
      container.classList.toggle('zoom-labels-1', zoom <= 11);
      container.classList.toggle('zoom-labels-2', zoom === 12);
      container.classList.toggle('zoom-labels-3', zoom === 13);
    };
    updateLabelVisibility();
    map.on('zoomend', updateLabelVisibility);
    return () => {
      map.off('zoomend', updateLabelVisibility);
    };
  }, [map]);

  // Zoom control defaults to top-left, which the address search box and
  // score selector already occupy — move it to top-right instead, where it
  // stacks neatly above the data-layer toggle control.
  useEffect(() => {
    const zoomControl = L.control.zoom({ position: 'topright' });
    zoomControl.addTo(map);
    return () => {
      map.removeControl(zoomControl);
    };
  }, [map]);

  useEffect(() => {
    let cancelled = false;
    const layersToClean: L.Layer[] = [];
    layerPoolsRef.current = [];

    const buildDistrictLayer = (
      geojson: any,
      neighborhoodMap: Map<number, Neighborhood>,
      allScores: number[]
    ) =>
      L.geoJSON(geojson, {
        style: (feature) => {
          const districtId = (feature?.id || feature?.properties?.district_id) as number;
          const neighborhood = neighborhoodMap.get(districtId);
          const score = neighborhood
            ? resolveScore(neighborhood, scoreMetricRef.current, matchWeightsRef.current)
            : 50;
          const isOverBudget = excludedDistrictIdsRef.current?.has(districtId) ?? false;
          // Colored by the same discrete letter-grade band as the badges
          // (not a continuous gradient) — a continuous scale bunches A and B
          // districts into near-identical dark shades since both sit at the
          // high end of the percentile range. Discrete bands guarantee same
          // grade = same color, different grade = visibly different color.
          const percentile = percentileRank(score, allScores);
          const color = isOverBudget ? '#d0d0d0' : gradeColor(getLetterGrade(percentile));

          const isSelected = selectedDistrict?.district_id === districtId;
          return {
            fillColor: color,
            fillOpacity: isOverBudget ? 0.25 : 0.7,
            color: isSelected ? '#ff00ff' : '#333',
            weight: isSelected ? 5 : 2,
            opacity: isSelected ? 1 : 0.5,
            // Path layers bubble clicks to the map by default. Without this,
            // every polygon click also fired the map's own click event —
            // which now also runs the district-select fallback below — and
            // since that fallback's point-in-polygon lookup is async, it
            // resolved just after the polygon's own handler had selected the
            // district, immediately toggling it back off.
            bubblingMouseEvents: false,
          };
        },
        onEachFeature: (feature, layer) => {
          const districtId = (feature?.id || feature?.properties?.district_id) as number;
          const neighborhood = neighborhoodMap.get(districtId);

          if (neighborhood) {
            districtBoundsRef.current[districtId] = (layer as L.Polygon).getBounds();

            layer.bindTooltip(escapeHtml(neighborhood.district_name), {
              permanent: true,
              direction: 'center',
              className: 'district-name-label',
              interactive: false,
            });

            layer.on('click', (e: L.LeafletMouseEvent) => {
              if (clickModeRef.current === 'place') {
                onMapClickRef.current?.(e.latlng.lat, e.latlng.lng);
                return;
              }
              if (clickModeRef.current !== 'district') return;
              const isCurrentlySelected = selectedDistrictRef.current?.district_id === districtId;
              onDistrictSelect(isCurrentlySelected ? null : neighborhood);
            });

            layer.on('mouseover', () => {
              if (selectedDistrictRef.current?.district_id === districtId) return;
              (layer as L.Path).setStyle({ color: '#333', weight: 3, opacity: 1 });
            });

            layer.on('mouseout', () => {
              const isSelected = selectedDistrictRef.current?.district_id === districtId;
              (layer as L.Path).setStyle({
                color: isSelected ? '#ff00ff' : '#333',
                weight: isSelected ? 5 : 2,
                opacity: isSelected ? 1 : 0.5,
              });
            });
          }
        },
      });

    const loadMap = async () => {
      try {
        const [stpaulNeighborhoodMap, mplsNeighborhoodMap] = await Promise.all([
          getNeighborhoodMap('stpaul'),
          getNeighborhoodMap('mpls').catch(() => new Map<number, Neighborhood>()),
        ]);
        neighborhoodMapsRef.current = [stpaulNeighborhoodMap, mplsNeighborhoodMap];
        const allNeighborhoods = [
          ...Array.from(stpaulNeighborhoodMap.values()),
          ...Array.from(mplsNeighborhoodMap.values()),
        ];
        const allScores = allNeighborhoods.map((n) => resolveScore(n, scoreMetricRef.current, matchWeightsRef.current));

        const stpaulResponse = await fetch('/data/boundaries.geojson');
        const stpaulGeojson = await stpaulResponse.json();

        if (cancelled) return;
        const districtPoolEntries: { layer: L.GeoJSON; neighborhoodMap: Map<number, Neighborhood> }[] = [];
        const stpaulLayer = buildDistrictLayer(stpaulGeojson, stpaulNeighborhoodMap, allScores);
        districtPoolEntries.push({ layer: stpaulLayer, neighborhoodMap: stpaulNeighborhoodMap });
        layersToClean.push(stpaulLayer);

        // Minneapolis district boundaries — colored/clickable like St. Paul
        // when neighborhoods_mpls.json has health-score data available.
        try {
          const mplsResponse = await fetch('/data/boundaries_mpls.geojson');
          if (mplsResponse.ok && !cancelled) {
            const mplsGeojson = await mplsResponse.json();
            if (!cancelled) {
              const mplsLayer = buildDistrictLayer(mplsGeojson, mplsNeighborhoodMap, allScores);
              districtPoolEntries.push({ layer: mplsLayer, neighborhoodMap: mplsNeighborhoodMap });
              layersToClean.push(mplsLayer);
            }
          }
        } catch (err) {
          console.error('Failed to load MPLS boundary data:', err);
        }

        if (cancelled) return;
        layerPoolsRef.current.push({ kind: 'district', entries: districtPoolEntries });

        // ZIP-level boundaries — a separate, finer-grained normalization
        // pool (every ZIP in the metro scored against every other ZIP, not
        // just districts). Optional: older builds may not have generated
        // these files yet, so a missing/failed fetch just skips ZIP view
        // rather than failing the whole map.
        try {
          const zipNeighborhoodMap = await getNeighborhoodMap('zip');
          const zipResponse = await fetch('/data/boundaries_zip.geojson');
          if (zipResponse.ok && !cancelled && zipNeighborhoodMap.size > 0) {
            const zipGeojson = await zipResponse.json();
            if (!cancelled) {
              const zipScores = Array.from(zipNeighborhoodMap.values()).map((n) =>
                resolveScore(n, scoreMetricRef.current, matchWeightsRef.current)
              );
              const zipLayer = buildDistrictLayer(zipGeojson, zipNeighborhoodMap, zipScores);
              layersToClean.push(zipLayer);
              layerPoolsRef.current.push({
                kind: 'zip',
                entries: [{ layer: zipLayer, neighborhoodMap: zipNeighborhoodMap }],
              });
            }
          }
        } catch (err) {
          console.error('Failed to load ZIP boundary data:', err);
        }

        if (cancelled) return;
        applyGranularityVisibility();

        // Light outer border around each city as a whole (dissolved from its
        // districts at build time — see pipeline/exports/export_city_outline.py),
        // separate from the individual district lines so the two cities read
        // as distinct areas at a glance. Added last + brought to front so it
        // renders on top of the district fill/stroke instead of getting
        // hidden underneath it.
        try {
          const outlineUrls = ['/data/city_outline_stpaul.geojson', '/data/city_outline_mpls.geojson'];
          for (const url of outlineUrls) {
            const response = await fetch(url);
            if (!response.ok || cancelled) continue;
            const geojson = await response.json();
            if (cancelled) break;
            const outlineLayer = L.geoJSON(geojson, {
              style: { color: '#555', weight: 3, opacity: 0.85, fill: false, interactive: false },
            }).addTo(map);
            outlineLayer.bringToFront();
            layersToClean.push(outlineLayer);
          }

          // The St. Paul/Minneapolis shared border specifically — a thin
          // filled strip (see export_city_outline.py; it's a ~40m-wide
          // polygon, not a single line, since the two cities' independently-
          // digitized boundaries don't share exact vertices) drawn on top of
          // both cities' outlines in a distinct color so it reads as "this
          // is the city line" rather than blending into either perimeter.
          const dividerResponse = await fetch('/data/city_divider.geojson');
          if (dividerResponse.ok && !cancelled) {
            const dividerGeojson = await dividerResponse.json();
            if (!cancelled && dividerGeojson.features?.length > 0) {
              const dividerLayer = L.geoJSON(dividerGeojson, {
                style: { color: '#e6550d', weight: 1, opacity: 0.9, fillColor: '#e6550d', fillOpacity: 0.7, interactive: false },
              }).addTo(map);
              dividerLayer.bringToFront();
              layersToClean.push(dividerLayer);
            }
          }
        } catch (err) {
          console.error('Failed to load city outline data:', err);
        }

        // Load the small radius-scoring baseline/tract files (used for
        // 1-mile "place" scoring) in the background; not required for the
        // map itself to render.
        (async () => {
          for (const city of ['stpaul', 'mpls'] as const) {
            try {
              const [baselineResp, tractsResp] = await Promise.all([
                fetch(`/data/radius_baseline_${city}.json`),
                fetch(`/data/tracts_affordability_${city}.json`),
              ]);
              if (baselineResp.ok) {
                radiusBaselineRef.current[city] = await baselineResp.json();
              }
              if (tractsResp.ok) {
                const tractsData = await tractsResp.json();
                tractsAffordabilityRef.current[city] = tractsData.tracts || [];
              }
            } catch (err) {
              console.error(`Failed to load radius scoring data for ${city}:`, err);
            }
          }
        })();

        // Default view: zoomed out enough to see all of St. Paul + Minneapolis
        // at once, centered on the pannable area (TWIN_CITIES_BOUNDS below).
        map.fitBounds(TWIN_CITIES_BOUNDS, { padding: [10, 10] });

        // Load point/line data-source layers (crime, permits, requests,
        // housing, transit, schools, trails) as toggleable overlays.
        // Fetched in parallel (not one-by-one) since these are independent
        // files — network latency no longer stacks up across all of them.
        const overlays: Record<string, L.Layer> = {};
        labelEntriesRef.current = {};
        labelGroupsRef.current = {};
        trailEntriesRef.current = [];
        const fetchedLayerFiles = await Promise.all(
          POINT_LAYER_FILES.map(async ({ url }) => {
            try {
              const resp = await fetch(url);
              if (!resp.ok) return null;
              return { url, geojson: await resp.json() };
            } catch (err) {
              console.error(`Failed to load point layer ${url}:`, err);
              return null;
            }
          })
        );
        for (const fetched of fetchedLayerFiles) {
          if (!fetched || cancelled) continue;
          const { url, geojson } = fetched;
          try {
            const bySource: Record<string, any[]> = {};
            for (const feature of geojson.features || []) {
              const source = feature.properties?.source || 'other';
              (bySource[source] = bySource[source] || []).push(feature);
            }

            for (const [source, features] of Object.entries(bySource)) {
              const color = POINT_LAYER_COLORS[source] || '#666';
              const label = POINT_LAYER_LABELS[source] || source;
              const isLines = features[0]?.geometry?.type === 'LineString';

              if (isLines) {
                // Trails/paths: individual polylines (no clustering), kept
                // in trailEntriesRef so renderTrails() can filter each one
                // to the search radius when a place is selected.
                if (!trailGroupRef.current) {
                  trailGroupRef.current = L.layerGroup().addTo(map);
                  overlays[label] = trailGroupRef.current;
                } else if (!overlays[label]) {
                  overlays[label] = trailGroupRef.current;
                }
                for (const feature of features) {
                  const coords = (feature.geometry?.coordinates || []) as [number, number][];
                  if (coords.length < 2) continue;
                  const latlngs = coords.map(([lon, lat]) => L.latLng(lat, lon));
                  const polyline = L.polyline(latlngs, { color, weight: 2, opacity: 0.6 });
                  const featLabel = feature.properties?.label || source;
                  const details = feature.properties?.details as Record<string, string | number> | undefined;
                  let html = `<div style="font-weight:600;margin-bottom:4px;">${escapeHtml(String(featLabel))}</div>`;
                  if (details && Object.keys(details).length > 0) {
                    html += '<table style="font-size:12px;">';
                    for (const [key, value] of Object.entries(details)) {
                      html += `<tr><td style="color:#666;padding-right:8px;vertical-align:top;">${escapeHtml(key)}</td><td>${escapeHtml(String(value))}</td></tr>`;
                    }
                    html += '</table>';
                  }
                  polyline.bindPopup(html, { maxWidth: 280 });
                  trailEntriesRef.current.push({ layer: polyline, latlngs, source });
                }
                continue;
              }

              // Point sources: collect markers per label now; renderAllLabels()
              // decides, per zoom level, which local groups exceed
              // CLUSTER_MIN_COUNT and should bundle into a cluster bubble.
              const emoji = POINT_LAYER_ICONS[source] || '📍';
              const icon = makeMarkerIcon(color, emoji);
              const useCanvas = features.length > CANVAS_MARKER_THRESHOLD;
              if (useCanvas && !canvasRendererRef.current) {
                // Default renderer pane is 'overlayPane', shared with the
                // district polygons — same-pane stacking let clicks fall
                // through to the polygon underneath instead of the marker.
                // 'markerPane' sits above it (same pane the old divIcon
                // markers used), so canvas markers win clicks again.
                canvasRendererRef.current = L.canvas({ padding: 0.5, pane: 'markerPane' });
              }
              const geoJsonLayer = L.geoJSON(
                { type: 'FeatureCollection', features } as any,
                {
                  pointToLayer: (feature, latlng) =>
                    useCanvas
                      ? L.circleMarker(latlng, {
                          renderer: canvasRendererRef.current!,
                          radius: 5,
                          color: '#fff',
                          weight: 1,
                          fillColor: color,
                          fillOpacity: 0.85,
                          // Unlike L.Marker, Path layers bubble click events
                          // to the map by default — without this, clicking a
                          // circle marker also fired the map's own click
                          // handler (drop search pin / select district),
                          // which stole the popup before it could show.
                          bubblingMouseEvents: false,
                        })
                      : L.marker(latlng, { icon }),
                  onEachFeature: (feature, layer) => {
                    const featLabel = feature.properties?.label || source;
                    const details = feature.properties?.details as Record<string, string | number> | undefined;
                    let html = `<div style="font-weight:600;margin-bottom:4px;">${escapeHtml(String(featLabel))}</div>`;
                    if (details && Object.keys(details).length > 0) {
                      html += '<table style="font-size:12px;">';
                      for (const [key, value] of Object.entries(details)) {
                        html += `<tr><td style="color:#666;padding-right:8px;vertical-align:top;">${escapeHtml(key)}</td><td>${escapeHtml(String(value))}</td></tr>`;
                      }
                      html += '</table>';
                    }
                    if (['schools', 'groceries', 'healthcare', 'restaurants', 'entertainment'].includes(source)) {
                      const query = encodeURIComponent(
                        `${String(featLabel)}${details?.Address ? ' ' + details.Address : ''}`
                      );
                      html += `<div style="margin-top:6px;"><a href="https://www.google.com/maps/search/?api=1&query=${query}" target="_blank" rel="noopener noreferrer" style="font-size:12px;color:#1a73e8;">Google Reviews ↗</a></div>`;
                    }
                    layer.bindPopup(html, { maxWidth: 280 });
                  },
                }
              );
              if (!labelEntriesRef.current[label]) labelEntriesRef.current[label] = [];
              if (!labelGroupsRef.current[label]) {
                const group = L.layerGroup().addTo(map);
                labelGroupsRef.current[label] = group;
                overlays[label] = group;
              }
              const group = labelGroupsRef.current[label];
              for (let i = 0; i < features.length; i++) {
                const marker = geoJsonLayer.getLayers()[i] as PointMarker;
                const districtId = features[i].properties?.district_id;
                labelEntriesRef.current[label].push({
                  marker,
                  districtId: typeof districtId === 'number' ? districtId : null,
                  source,
                });
                if (!useCanvas) {
                  // Added once, permanently — renderAllLabels() toggles
                  // display via setMarkerVisible() rather than re-adding, so
                  // Leaflet never has to rebuild the icon DOM node per filter
                  // change (the cause of selection lag on large layers).
                  group.addLayer(marker);
                }
                // Canvas circle markers are left un-added here; renderAllLabels()
                // adds/removes them directly since that's already cheap for a
                // canvas layer (no DOM icon to rebuild) and also disables hit
                // testing for markers that are currently filtered out.
              }
            }
          } catch (err) {
            console.error(`Failed to load point layer ${url}:`, err);
          }
        }

        renderAllLabels();
        renderTrails();

        if (cancelled) return;

        for (const layer of Object.values(overlays)) {
          layersToClean.push(layer);
        }

        setIsLoading(false);
      } catch (error) {
        console.error('Failed to load boundary data:', error);
        setIsLoading(false);
      }
    };

    loadMap();

    return () => {
      cancelled = true;
      for (const layer of layersToClean) {
        map.removeLayer(layer);
      }
    };
  }, [map, onDistrictSelect]);

  useEffect(() => {
    for (const pool of layerPoolsRef.current) {
      for (const { layer: geoJsonLayer } of pool.entries) {
        geoJsonLayer.eachLayer((layer: L.Layer) => {
          if (layer instanceof L.Path) {
            const feature = (layer as any).feature;
            const districtId = (feature?.id || feature?.properties?.district_id) as number;
            const isSelected = selectedDistrict?.district_id === districtId;

            layer.setStyle({
              color: isSelected ? '#ff00ff' : '#333',
              weight: isSelected ? 5 : 2,
              opacity: isSelected ? 1 : 0.5,
            });
          }
        });
      }
    }
  }, [selectedDistrict]);

  useEffect(() => {
    if (flyToLocation) {
      map.flyTo([flyToLocation.lat, flyToLocation.lon], 15);
    }
  }, [flyToLocation, map]);

  // Recolor district/zip fills when the selected score metric changes,
  // without refetching/rebuilding the whole map. Each pool (district vs.
  // zip) gets its own min/max, matching how each is normalized separately
  // on the backend.
  useEffect(() => {
    for (const pool of layerPoolsRef.current) {
      const poolNeighborhoods = pool.entries.flatMap((e) => Array.from(e.neighborhoodMap.values()));
      const poolScores = poolNeighborhoods.map((n) => resolveScore(n, scoreMetric, matchWeights));

      for (const { layer: geoJsonLayer, neighborhoodMap } of pool.entries) {
        geoJsonLayer.eachLayer((layer: L.Layer) => {
          if (layer instanceof L.Path) {
            const feature = (layer as any).feature;
            const districtId = (feature?.id || feature?.properties?.district_id) as number;
            const neighborhood = neighborhoodMap.get(districtId);
            const score = neighborhood ? resolveScore(neighborhood, scoreMetric, matchWeights) : 50;
            const isOverBudget = excludedDistrictIds?.has(districtId) ?? false;
            const percentile = percentileRank(score, poolScores);
            layer.setStyle({
              fillColor: isOverBudget ? '#d0d0d0' : gradeColor(getLetterGrade(percentile)),
              fillOpacity: isOverBudget ? 0.25 : 0.7,
            });
          }
        });
      }
    }
  }, [scoreMetric, matchWeights, excludedDistrictIds]);

  // Emphasize districts matching the letter grade the user is hovering in
  // the legend's scale strip (Legend.tsx), and dim everything else. Clearing
  // the hover (highlightedGrade === null) restores normal styling.
  useEffect(() => {
    for (const pool of layerPoolsRef.current) {
      const poolNeighborhoods = pool.entries.flatMap((e) => Array.from(e.neighborhoodMap.values()));
      const poolScores = poolNeighborhoods.map((n) => resolveScore(n, scoreMetric, matchWeights));

      for (const { layer: geoJsonLayer, neighborhoodMap } of pool.entries) {
        geoJsonLayer.eachLayer((layer: L.Layer) => {
          if (!(layer instanceof L.Path)) return;
          const feature = (layer as any).feature;
          const districtId = (feature?.id || feature?.properties?.district_id) as number;
          const neighborhood = neighborhoodMap.get(districtId);
          const isOverBudget = excludedDistrictIds?.has(districtId) ?? false;
          const isSelected = selectedDistrict?.district_id === districtId;

          if (!highlightedGrade) {
            layer.setStyle({
              fillOpacity: isOverBudget ? 0.25 : 0.7,
              weight: isSelected ? 5 : 2,
            });
            return;
          }

          const score = neighborhood ? resolveScore(neighborhood, scoreMetric, matchWeights) : 50;
          const percentile = percentileRank(score, poolScores);
          const matches = !isOverBudget && getLetterGrade(percentile) === highlightedGrade;

          layer.setStyle({
            fillOpacity: matches ? 0.9 : 0.1,
            weight: matches ? (isSelected ? 6 : 4) : (isSelected ? 5 : 2),
          });
        });
      }
    }
  }, [highlightedGrade, scoreMetric, matchWeights, excludedDistrictIds, selectedDistrict]);

  // Drop (or move) a labeled marker at the searched address/place so the
  // user can see exactly what location their search resolved to.
  useEffect(() => {
    if (searchMarkerRef.current) {
      map.removeLayer(searchMarkerRef.current);
      searchMarkerRef.current = null;
    }
    if (searchRadiusCircleRef.current) {
      map.removeLayer(searchRadiusCircleRef.current);
      searchRadiusCircleRef.current = null;
    }
    if (searchMarker) {
      const marker = L.marker([searchMarker.lat, searchMarker.lon], { icon: makeSearchMarkerIcon() });
      marker.bindTooltip(escapeHtml(searchMarker.label), {
        permanent: true,
        direction: 'top',
        offset: [0, -26],
        className: 'search-marker-label',
      });
      marker.on('click', (e: L.LeafletMouseEvent) => {
        // Stop the native event too, so the map's own DOM click listener
        // (which re-drops a pin in 'place' mode) never sees this click.
        L.DomEvent.stop(e.originalEvent ?? (e as unknown as Event));
        onClearSearchMarkerRef.current?.();
      });
      marker.addTo(map);
      searchMarkerRef.current = marker;

      // Visualize the 1-mile radius within which nearby data-point markers
      // are shown, regardless of district.
      const circle = L.circle([searchMarker.lat, searchMarker.lon], {
        radius: 1609.34,
        color: '#e31a1c',
        weight: 1.5,
        fillColor: '#e31a1c',
        fillOpacity: 0.05,
        dashArray: '4 4',
      });
      circle.addTo(map);
      searchRadiusCircleRef.current = circle;

      // Compute a 1-mile-radius score for the sidebar, on a comparable 0-100
      // scale to district scores — see web/lib/radiusScore.ts for the method
      // and its limitations (per-area, not per-capita; only sources with
      // client-side raw geometry are included).
      if (onPlaceScoreComputedRef.current) {
        const { lat, lon, label, address } = searchMarker;
        findDistrictForPoint(lat, lon).then((result) => {
          const city = result ? cityForDistrictId(result.districtId) : 'stpaul';
          const baseline = radiusBaselineRef.current[city];
          if (!baseline) return;

          const points: PointEntry[] = [];
          for (const entries of Object.values(labelEntriesRef.current)) {
            for (const entry of entries) {
              points.push({ source: entry.source, latlng: entry.marker.getLatLng() });
            }
          }
          const trails: TrailEntry[] = trailEntriesRef.current.map((t) => ({ latlngs: t.latlngs, source: t.source }));
          const tracts = tractsAffordabilityRef.current[city];

          const neighborhood = computeRadiusNeighborhood({
            lat,
            lon,
            label,
            address,
            baseline,
            points,
            trails,
            tracts,
            containingDistrictId: result?.districtId ?? null,
          });
          onPlaceScoreComputedRef.current?.(neighborhood);
        });
      }
    }
    // NOTE: deliberately does NOT depend on onClearSearchMarker (read through
    // a ref instead). It's an inline arrow in the parent, so a dependency on
    // it re-ran this effect on every parent render — tearing down and
    // recreating the marker's DOM element constantly. That both swallowed
    // clicks on the marker (a native click needs mousedown and mouseup on the
    // same element) and re-fired the radius-score computation, whose result is
    // a fresh object passed to setSelectedDistrict, causing another render and
    // so on in a loop.
  }, [searchMarker, map]);

  // "Find Your Match" area recommendations: a numbered, colored circle per
  // recommended district — its 1-mile radius, anchored on that district's
  // highest-scoring apartment building. The buildings themselves are shown
  // by the always-on apartment-buildings layer below, not drawn here.
  useEffect(() => {
    if (regionCircleLayerRef.current) {
      map.removeLayer(regionCircleLayerRef.current);
      regionCircleLayerRef.current = null;
    }
    if (!matchRegions || matchRegions.length === 0) return;

    const circleGroup = L.layerGroup();
    matchRegions.forEach((region, i) => {
      const color = MATCH_REGION_COLORS[i % MATCH_REGION_COLORS.length];
      const active = region.id === activeRegionId;
      L.circle([region.center.lat, region.center.lon], {
        radius: region.radiusMeters,
        color,
        weight: active ? 2.5 : 1.5,
        fillColor: color,
        fillOpacity: active ? 0.12 : 0.05,
        dashArray: active ? undefined : '4 4',
      }).addTo(circleGroup);

      const marker = L.marker([region.center.lat, region.center.lon], {
        icon: makeRegionCenterIcon(region.rank, color, active),
      });
      marker.bindTooltip(escapeHtml(region.districtName), {
        direction: 'top',
        offset: [0, active ? -18 : -14],
      });
      marker.on('click', (e: L.LeafletMouseEvent) => {
        L.DomEvent.stop(e.originalEvent ?? (e as unknown as Event));
        onSelectRegionRef.current?.(region);
      });
      marker.addTo(circleGroup);
    });
    circleGroup.addTo(map);
    regionCircleLayerRef.current = circleGroup;
  }, [matchRegions, activeRegionId, map]);

  // Always-available "Apartment Buildings" point layer (toggled from the
  // legend like any other Data Points source, independent of "Find Your
  // Match"). Loaded once and rendered as canvas dots — same reason every
  // other high-volume point layer uses canvas instead of DOM markers (see
  // CANVAS_MARKER_THRESHOLD above): ~3,500 buildings across both cities
  // would visibly stutter panning as real DOM icons.
  const [apartmentDataVersion, setApartmentDataVersion] = useState(0);

  useEffect(() => {
    if (!apartmentBuildingsVisible || apartmentBuildingsDataRef.current) return;
    let cancelled = false;
    Promise.all(
      (['stpaul', 'mpls'] as const).map((city) =>
        fetch(`/data/apartment_buildings_${city}.json`)
          .then((r) => (r.ok ? r.json() : []))
          .catch(() => [])
      )
    ).then(([stpaul, mpls]) => {
      if (cancelled) return;
      apartmentBuildingsDataRef.current = [...stpaul, ...mpls];
      // Trigger the render effect below now that data has arrived.
      setApartmentDataVersion((v) => v + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [apartmentBuildingsVisible]);

  // An active "Find Your Match" region always shows its own buildings (the
  // recommendation is the area, so picking it should reveal what's in it),
  // regardless of whether the always-on "Apartment Buildings" layer toggle is
  // on. Keyed by id so a building in both sets isn't drawn twice.
  const activeRegion = activeRegionId ? matchRegions?.find((r) => r.id === activeRegionId) : null;

  useEffect(() => {
    if (apartmentLayerGroupRef.current) {
      map.removeLayer(apartmentLayerGroupRef.current);
      apartmentLayerGroupRef.current = null;
    }
    const showAll = apartmentBuildingsVisible && apartmentBuildingsDataRef.current;
    if (!showAll && !activeRegion) return;

    // Reuse the single shared canvas renderer (canvasRendererRef) that every
    // other high-volume point layer draws into. Two separate L.Canvas
    // instances in the same pane each create their own full-map <canvas>
    // element and bind click handling directly to it — whichever one ends
    // up on top in the DOM silently swallows every click across the whole
    // map for hit-testing, including clicks over the other canvas's
    // markers, which never fire at all. A single shared renderer avoids
    // that stacking race entirely.
    if (!canvasRendererRef.current) {
      canvasRendererRef.current = L.canvas({ padding: 0.5, pane: 'markerPane' });
    }
    const group = L.layerGroup();
    const seen = new Set<string>();
    const addMarker = (b: { id: string; name: string; lat: number; lon: number }) => {
      if (seen.has(b.id)) return;
      seen.add(b.id);
      const marker = L.circleMarker([b.lat, b.lon], {
        renderer: canvasRendererRef.current!,
        radius: 5,
        color: '#333',
        weight: 2,
        fillColor: '#fff',
        fillOpacity: 1,
      });
      marker.bindTooltip(escapeHtml(b.name), { direction: 'top', offset: [0, -8] });
      marker.on('click', (e) => {
        // Path layers bubble click events to the map by default; without
        // stopping it, the map's own click handler below fires right after
        // and overwrites this selection with its own district/place logic.
        L.DomEvent.stopPropagation(e);
        onSelectApartmentBuildingRef.current?.(b as ApartmentBuildingPoint);
      });
      marker.addTo(group);
    };

    activeRegion?.buildings.forEach(addMarker);
    if (showAll) {
      apartmentBuildingsDataRef.current!.forEach((b) => {
        if (excludedDistrictIds?.has(b.district_id)) return;
        addMarker(b);
      });
    }
    group.addTo(map);
    apartmentLayerGroupRef.current = group;
  }, [apartmentBuildingsVisible, apartmentDataVersion, map, excludedDistrictIds, activeRegion]);

  return (
    <>
      <TileLayer
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      />
      {isLoading && (
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            zIndex: 1000,
            backgroundColor: 'white',
            padding: '20px',
            borderRadius: '8px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
          }}
        >
          Loading map...
        </div>
      )}
    </>
  );
}

const TWIN_CITIES_BOUNDS: L.LatLngBoundsExpression = [
  [44.85, -93.38],  // Southwest corner
  [45.07, -92.94],  // Northeast corner
];

export default function NeighborhoodMap({
  onDistrictSelect,
  selectedDistrict,
  flyToLocation,
  searchMarker,
  onClearSearchMarker,
  onMapClick,
  clickMode,
  scoreMetric,
  onPlaceScoreComputed,
  hiddenSources,
  matchWeights,
  excludedDistrictIds,
  granularity,
  matchRegions,
  activeRegionId,
  onSelectRegion,
  apartmentBuildingsVisible,
  onSelectApartmentBuilding,
  highlightedGrade,
}: NeighborhoodMapProps) {
  return (
    <MapContainer
      center={[44.9537, -93.094]}
      zoom={11}
      minZoom={11}
      maxBounds={TWIN_CITIES_BOUNDS}
      maxBoundsViscosity={1.0}
      zoomControl={false}
      className="gmap-container"
      style={{ height: '100%', width: '100%' }}
    >
      <MapContent
        onDistrictSelect={onDistrictSelect}
        selectedDistrict={selectedDistrict}
        flyToLocation={flyToLocation}
        searchMarker={searchMarker}
        onClearSearchMarker={onClearSearchMarker}
        onMapClick={onMapClick}
        clickMode={clickMode}
        scoreMetric={scoreMetric}
        onPlaceScoreComputed={onPlaceScoreComputed}
        hiddenSources={hiddenSources}
        matchWeights={matchWeights}
        excludedDistrictIds={excludedDistrictIds}
        granularity={granularity}
        matchRegions={matchRegions}
        activeRegionId={activeRegionId}
        onSelectRegion={onSelectRegion}
        apartmentBuildingsVisible={apartmentBuildingsVisible}
        onSelectApartmentBuilding={onSelectApartmentBuilding}
        highlightedGrade={highlightedGrade}
      />
    </MapContainer>
  );
}
