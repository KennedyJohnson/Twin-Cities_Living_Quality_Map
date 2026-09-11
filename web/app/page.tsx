'use client';

import { useCallback, useRef, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import NeighborhoodSidebar from '@/components/NeighborhoodSidebar';
import AddressSearch from '@/components/AddressSearch';
import Legend from '@/components/Legend';
import ScoreSelector from '@/components/ScoreSelector';
import type { Neighborhood } from '@/types/neighborhood';
import type { ScoreMetricKey } from '@/lib/scoreMetric';
import type { MapClickMode } from '@/components/NeighborhoodMap';
import { reverseGeocode, googleMapsSearchUrl, snapToNearestBuilding } from '@/lib/geo';
import { POINT_LAYER_LABELS } from '@/lib/pointLayerColors';

const NeighborhoodMap = dynamic(() => import('@/components/NeighborhoodMap'), {
  ssr: false,
  loading: () => <div>Loading map...</div>,
});

export default function Home() {
  const [selectedDistrict, setSelectedDistrict] = useState<Neighborhood | null>(null);
  const [flyToLocation, setFlyToLocation] = useState<{ lat: number; lon: number } | null>(null);
  const [searchMarker, setSearchMarker] = useState<{ lat: number; lon: number; label: string } | null>(null);
  const [scoreMetric, setScoreMetric] = useState<ScoreMetricKey>('health_score');
  const [clickMode, setClickMode] = useState<MapClickMode>('district');
  const [hiddenSources, setHiddenSources] = useState<Set<string>>(
    () => new Set(Object.keys(POINT_LAYER_LABELS))
  );
  const [sidebarWidth, setSidebarWidth] = useState(320);
  const [isDraggingSidebar, setIsDraggingSidebar] = useState(false);
  const dragStateRef = useRef<{ startX: number; startWidth: number } | null>(null);

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
  const revealNearbyLayers = () => {
    setHiddenSources((prev) => {
      if (!prev.has('groceries') && !prev.has('restaurants')) return prev;
      const next = new Set(prev);
      next.delete('groceries');
      next.delete('restaurants');
      return next;
    });
  };

  const handleAddressSelect = (address: string, lat: number, lon: number, district: Neighborhood | null, label: string) => {
    // Shown briefly until NeighborhoodMap's radius-score effect reports the
    // computed 1-mile-radius result for this same searchMarker.
    setSelectedDistrict(district);
    setFlyToLocation({ lat, lon });
    setSearchMarker({ lat, lon, label });
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
        setSearchMarker(null);
        setSelectedDistrict(null);
        return;
      }
    }

    // Drop the marker immediately at the raw click point so it appears
    // instantly, then refine it in place once the building-snap and
    // reverse-geocode calls (run in parallel, not sequentially) resolve.
    setSearchMarker({ lat, lon, label: 'Loading…' });
    revealNearbyLayers();
    const [snapped, label] = await Promise.all([
      snapToNearestBuilding(lat, lon),
      reverseGeocode(lat, lon),
    ]);
    setSearchMarker({ lat: snapped.lat, lon: snapped.lon, label });
  };

  return (
    <div className="container">
      <div className="map-container">
        <NeighborhoodMap
          onDistrictSelect={setSelectedDistrict}
          selectedDistrict={selectedDistrict}
          flyToLocation={flyToLocation}
          searchMarker={searchMarker}
          onClearSearchMarker={() => setSearchMarker(null)}
          onMapClick={handleMapClick}
          clickMode={clickMode}
          scoreMetric={scoreMetric}
          onPlaceScoreComputed={setSelectedDistrict}
          hiddenSources={hiddenSources}
        />
        <Legend
          scoreMetric={scoreMetric}
          hiddenSources={hiddenSources}
          onToggleSource={(key) =>
            setHiddenSources((prev) => {
              const next = new Set(prev);
              if (next.has(key)) next.delete(key);
              else next.add(key);
              return next;
            })
          }
          onDeselectAll={(allKeys) => setHiddenSources(new Set(allKeys))}
        />
        <ScoreSelector value={scoreMetric} onChange={setScoreMetric} />
        <AddressSearch onAddressSelect={handleAddressSelect} />
        <div className="click-mode-toggle">
          <span className="click-mode-toggle-label">Clicking the map selects:</span>
          <div className="click-mode-toggle-buttons">
            <button
              type="button"
              className={clickMode === 'district' ? 'active' : ''}
              onClick={() => setClickMode('district')}
            >
              District
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
        {(searchMarker || selectedDistrict) && (
          <div className="selected-place">
            {searchMarker && (
              <>
                <span className="selected-place-name">{searchMarker.label}</span>
                <a
                  href={googleMapsSearchUrl(searchMarker.lat, searchMarker.lon, searchMarker.label)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="selected-place-reviews-link"
                >
                  View reviews on Google ↗
                </a>
              </>
            )}
            {!searchMarker && selectedDistrict && (
              <span className="selected-place-name">{selectedDistrict.district_name}</span>
            )}
            <button
              type="button"
              className="deselect-marker-button"
              onClick={() => {
                setSearchMarker(null);
                setSelectedDistrict(null);
              }}
            >
              Deselect all
            </button>
          </div>
        )}
        <div
          style={{
            position: 'absolute',
            bottom: '34px',
            right: '10px',
            zIndex: 1000,
            display: 'flex',
            gap: '10px',
            background: 'white',
            padding: '6px 10px',
            borderRadius: '6px',
            boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
            fontSize: '12px',
          }}
        >
          <Link href="/trends" style={{ color: '#756bb1' }}>Trends</Link>
          <Link href="/about" style={{ color: '#756bb1' }}>About</Link>
        </div>
      </div>
      <div className="sidebar-wrapper" style={{ width: sidebarWidth }}>
        <div
          className={`sidebar-resize-handle${isDraggingSidebar ? ' dragging' : ''}`}
          onMouseDown={handleResizeStart}
        />
        <NeighborhoodSidebar district={selectedDistrict} onSelectDistrict={setSelectedDistrict} />
      </div>
    </div>
  );
}
