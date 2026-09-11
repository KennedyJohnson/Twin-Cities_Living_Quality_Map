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
import { reverseGeocode, googleMapsSearchUrl } from '@/lib/geo';

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

  const handleAddressSelect = (address: string, lat: number, lon: number, district: Neighborhood | null, label: string) => {
    // Shown briefly until NeighborhoodMap's radius-score effect reports the
    // computed 1-mile-radius result for this same searchMarker.
    setSelectedDistrict(district);
    setFlyToLocation({ lat, lon });
    setSearchMarker({ lat, lon, label });
  };

  const handleMapClick = async (lat: number, lon: number) => {
    const label = await reverseGeocode(lat, lon);
    setSearchMarker({ lat, lon, label });
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
        />
        <Legend scoreMetric={scoreMetric} />
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
        {searchMarker && (
          <div className="selected-place">
            <span className="selected-place-name">{searchMarker.label}</span>
            <a
              href={googleMapsSearchUrl(searchMarker.lat, searchMarker.lon, searchMarker.label)}
              target="_blank"
              rel="noopener noreferrer"
              className="selected-place-reviews-link"
            >
              View reviews on Google ↗
            </a>
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
          <Link href="/methodology" style={{ color: '#756bb1' }}>How we calculate this</Link>
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
