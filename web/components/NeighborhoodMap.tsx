'use client';

import { useEffect, useRef, useState } from 'react';
import { MapContainer, TileLayer, GeoJSON, useMap } from 'react-leaflet';
import L from 'leaflet';
import { getHealthScoreColor } from '@/lib/ColorScale';
import { loadNeighborhoodData, getNeighborhoodMap } from '@/lib/loadNeighborhoodData';
import { POINT_LAYER_COLORS, POINT_LAYER_LABELS, POINT_LAYER_ICONS, CANVAS_MARKER_THRESHOLD } from '@/lib/pointLayerColors';
import { getScoreValue, ScoreMetricKey } from '@/lib/scoreMetric';
import { findDistrictForPoint, cityForDistrictId, resolveNeighborhoodForPoint } from '@/lib/geo';
import {
  computeRadiusNeighborhood,
  RadiusBaseline,
  TractAffordabilityRow,
  PointEntry,
  TrailEntry,
} from '@/lib/radiusScore';

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
  { key: 'lines_trails', url: '/data/lines_trails.json' },
];

export type MapClickMode = 'district' | 'place';

interface NeighborhoodMapProps {
  onDistrictSelect: (district: Neighborhood | null) => void;
  selectedDistrict: Neighborhood | null;
  flyToLocation?: { lat: number; lon: number } | null;
  searchMarker?: { lat: number; lon: number; label: string } | null;
  onClearSearchMarker?: () => void;
  onMapClick?: (lat: number, lon: number) => void;
  clickMode?: MapClickMode;
  scoreMetric?: ScoreMetricKey;
  onPlaceScoreComputed?: (neighborhood: Neighborhood) => void;
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
}: NeighborhoodMapProps) {
  const map = useMap();
  const radiusBaselineRef = useRef<Record<'stpaul' | 'mpls', RadiusBaseline | null>>({ stpaul: null, mpls: null });
  const tractsAffordabilityRef = useRef<Record<'stpaul' | 'mpls', TractAffordabilityRow[]>>({ stpaul: [], mpls: [] });
  const onPlaceScoreComputedRef = useRef(onPlaceScoreComputed);
  onPlaceScoreComputedRef.current = onPlaceScoreComputed;
  const geoJsonLayersRef = useRef<L.GeoJSON[]>([]);
  const searchMarkerRef = useRef<L.Marker | null>(null);
  const searchRadiusCircleRef = useRef<L.Circle | null>(null);
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
  const groceryGroupRef = useRef<L.LayerGroup | null>(null);
  // Trail/path segments: kept separately from point markers since they're
  // polylines (no single lat/lon) and never carry a district_id, so they're
  // filtered purely by "does any vertex fall within the search radius".
  const trailEntriesRef = useRef<{ layer: L.Layer; latlngs: L.LatLng[]; source: string }[]>([]);
  const trailGroupRef = useRef<L.LayerGroup | null>(null);
  const selectedDistrictRef = useRef<Neighborhood | null>(selectedDistrict);
  const searchMarkerPropRef = useRef<{ lat: number; lon: number; label: string } | null | undefined>(searchMarker);
  const clickModeRef = useRef<MapClickMode>(clickMode);
  const neighborhoodMapsRef = useRef<Map<number, Neighborhood>[]>([]);
  const scoreMetricRef = useRef<ScoreMetricKey>(scoreMetric);
  const districtBoundsRef = useRef<Record<number, L.LatLngBounds>>({});
  const [isLoading, setIsLoading] = useState(true);

  const isEntryVisible = (entry: { marker: PointMarker; districtId: number | null }) => {
    const sm = searchMarkerPropRef.current;
    if (sm) {
      const searchLatLng = L.latLng(sm.lat, sm.lon);
      return entry.marker.getLatLng().distanceTo(searchLatLng) <= 1609.34; // 1 mile
    }
    const sd = selectedDistrictRef.current;
    return !sd || entry.districtId === sd.district_id;
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

  // Trails only get radius-filtered when a place is selected (search or map
  // click); with no search marker active, every trail is shown as before —
  // there's no per-district trail filter to fall back to.
  const renderTrails = () => {
    const group = trailGroupRef.current;
    if (!group) return;
    group.clearLayers();
    const sm = searchMarkerPropRef.current;
    for (const entry of trailEntriesRef.current) {
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
    clickModeRef.current = clickMode;
  }, [clickMode]);

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
      if (mode === 'place') {
        onMapClick?.(e.latlng.lat, e.latlng.lng);
        return;
      }
      if (mode === 'district') {
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
    let controlToClean: L.Control | null = null;
    geoJsonLayersRef.current = [];

    const buildDistrictLayer = (
      geojson: any,
      neighborhoodMap: Map<number, Neighborhood>,
      scoreMin: number,
      scoreMax: number
    ) =>
      L.geoJSON(geojson, {
        style: (feature) => {
          const districtId = (feature?.id || feature?.properties?.district_id) as number;
          const neighborhood = neighborhoodMap.get(districtId);
          const score = neighborhood ? getScoreValue(neighborhood, scoreMetricRef.current) : (scoreMin + scoreMax) / 2;
          const color = getHealthScoreColor(score, scoreMin, scoreMax);

          const isSelected = selectedDistrict?.district_id === districtId;
          return {
            fillColor: color,
            fillOpacity: 0.7,
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

            layer.on('click', () => {
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
        const allScores = allNeighborhoods.map((n) => getScoreValue(n, scoreMetricRef.current));
        const scoreMin = allScores.length > 0 ? Math.min(...allScores) : 0;
        const scoreMax = allScores.length > 0 ? Math.max(...allScores) : 100;

        const stpaulResponse = await fetch('/data/boundaries.geojson');
        const stpaulGeojson = await stpaulResponse.json();

        if (cancelled) return;
        const stpaulLayer = buildDistrictLayer(stpaulGeojson, stpaulNeighborhoodMap, scoreMin, scoreMax);
        geoJsonLayersRef.current.push(stpaulLayer);
        stpaulLayer.addTo(map);
        layersToClean.push(stpaulLayer);

        // Minneapolis district boundaries — colored/clickable like St. Paul
        // when neighborhoods_mpls.json has health-score data available.
        try {
          const mplsResponse = await fetch('/data/boundaries_mpls.geojson');
          if (mplsResponse.ok && !cancelled) {
            const mplsGeojson = await mplsResponse.json();
            if (!cancelled) {
              const mplsLayer = buildDistrictLayer(mplsGeojson, mplsNeighborhoodMap, scoreMin, scoreMax);
              geoJsonLayersRef.current.push(mplsLayer);
              mplsLayer.addTo(map);
              layersToClean.push(mplsLayer);
            }
          }
        } catch (err) {
          console.error('Failed to load MPLS boundary data:', err);
        }

        if (cancelled) return;

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

        // Fit map bounds to Twin Cities metro area
        const bounds = L.latLngBounds([
          [44.8, -93.4],   // Southwest corner
          [45.1, -92.8],   // Northeast corner
        ]);
        map.fitBounds(bounds, { padding: [50, 50] });

        // Load point/line data-source layers (crime, permits, requests,
        // housing, transit, schools, trails) as toggleable overlays.
        const overlays: Record<string, L.Layer> = {};
        labelEntriesRef.current = {};
        labelGroupsRef.current = {};
        trailEntriesRef.current = [];
        for (const { url } of POINT_LAYER_FILES) {
          try {
            const resp = await fetch(url);
            if (!resp.ok || cancelled) continue;
            const geojson = await resp.json();

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
                  trailGroupRef.current = L.layerGroup();
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
                    layer.bindPopup(html, { maxWidth: 280 });
                  },
                }
              );
              if (!labelEntriesRef.current[label]) labelEntriesRef.current[label] = [];
              if (!labelGroupsRef.current[label]) {
                const group = L.layerGroup();
                labelGroupsRef.current[label] = group;
                overlays[label] = group;
                if (source === 'groceries') {
                  groceryGroupRef.current = group;
                }
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

        if (Object.keys(overlays).length > 0) {
          const control = L.control.layers(undefined, overlays, { collapsed: true });
          control.addTo(map);
          controlToClean = control;
          // Markers in a layer that isn't on the map yet have no DOM element,
          // so setMarkerVisible() no-ops for them until the layer is toggled
          // on — at which point Leaflet shows every marker by default. Re-run
          // the filters so the current selection/search radius still applies.
          map.on('overlayadd', () => {
            renderAllLabels();
            renderTrails();
          });
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
      map.off('overlayadd');
      for (const layer of layersToClean) {
        map.removeLayer(layer);
      }
      if (controlToClean) {
        map.removeControl(controlToClean);
      }
    };
  }, [map, onDistrictSelect]);

  useEffect(() => {
    for (const geoJsonLayer of geoJsonLayersRef.current) {
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
  }, [selectedDistrict]);

  useEffect(() => {
    if (flyToLocation) {
      map.flyTo([flyToLocation.lat, flyToLocation.lon], 15);
    }
  }, [flyToLocation, map]);

  // Recolor district fills when the selected score metric changes, without
  // refetching/rebuilding the whole map.
  useEffect(() => {
    const allNeighborhoods = neighborhoodMapsRef.current.flatMap((m) => Array.from(m.values()));
    const allScores = allNeighborhoods.map((n) => getScoreValue(n, scoreMetric));
    const scoreMin = allScores.length > 0 ? Math.min(...allScores) : 0;
    const scoreMax = allScores.length > 0 ? Math.max(...allScores) : 100;

    for (let i = 0; i < geoJsonLayersRef.current.length; i++) {
      const geoJsonLayer = geoJsonLayersRef.current[i];
      const neighborhoodMap = neighborhoodMapsRef.current[i];
      if (!neighborhoodMap) continue;

      geoJsonLayer.eachLayer((layer: L.Layer) => {
        if (layer instanceof L.Path) {
          const feature = (layer as any).feature;
          const districtId = (feature?.id || feature?.properties?.district_id) as number;
          const neighborhood = neighborhoodMap.get(districtId);
          const score = neighborhood ? getScoreValue(neighborhood, scoreMetric) : (scoreMin + scoreMax) / 2;
          layer.setStyle({ fillColor: getHealthScoreColor(score, scoreMin, scoreMax) });
        }
      });
    }
  }, [scoreMetric]);

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
      if (onClearSearchMarker) {
        marker.on('click', () => onClearSearchMarker());
      }
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

      // Auto-enable the grocery store and trail layers so results near the
      // searched location show up immediately, without requiring the user
      // to dig into the layer-toggle control first.
      if (groceryGroupRef.current && !map.hasLayer(groceryGroupRef.current)) {
        map.addLayer(groceryGroupRef.current);
      }
      if (trailGroupRef.current && !map.hasLayer(trailGroupRef.current)) {
        map.addLayer(trailGroupRef.current);
      }

      // Compute a 1-mile-radius score for the sidebar, on a comparable 0-100
      // scale to district scores — see web/lib/radiusScore.ts for the method
      // and its limitations (per-area, not per-capita; only sources with
      // client-side raw geometry are included).
      if (onPlaceScoreComputedRef.current) {
        const { lat, lon, label } = searchMarker;
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
            baseline,
            points,
            trails,
            tracts,
          });
          onPlaceScoreComputedRef.current?.(neighborhood);
        });
      }
    }
  }, [searchMarker, map, onClearSearchMarker]);

  return (
    <>
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
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
  [44.75, -93.5],  // Southwest corner
  [45.15, -92.7],  // Northeast corner
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
      />
    </MapContainer>
  );
}
