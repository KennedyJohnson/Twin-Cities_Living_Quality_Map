'use client';

import { useEffect, useRef, useState } from 'react';
import { useMap } from '@vis.gl/react-google-maps';
import { getHealthScoreColor } from '@/lib/ColorScale';
import { loadNeighborhoodData, getNeighborhoodMap } from '@/lib/loadNeighborhoodData';
import type { Neighborhood } from '@/types/neighborhood';

interface NeighborhoodMapProps {
  onDistrictSelect: (district: Neighborhood | null) => void;
  selectedDistrict: Neighborhood | null;
}

export default function NeighborhoodMap({
  onDistrictSelect,
  selectedDistrict,
}: NeighborhoodMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const dataLayerRef = useRef<google.maps.Data | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const map = useMap();

  useEffect(() => {
    if (!window.google || !mapRef.current || map) return;

    // Initialize map centered on St. Paul
    const mapInstance = new google.maps.Map(mapRef.current, {
      zoom: 11,
      center: { lat: 44.9537, lng: -93.094 },
      mapTypeId: 'roadmap',
      styles: [
        {
          featureType: 'administrative',
          elementType: 'geometry',
          stylers: [{ color: '#e0e0e0' }],
        },
      ],
    });

    mapInstanceRef.current = mapInstance;
    const dataLayer = new google.maps.Data({ map: mapInstance });
    dataLayerRef.current = dataLayer;

    // Load and render boundaries
    loadNeighborhoodData()
      .then(async () => {
        const response = await fetch('/data/boundaries.geojson');
        const geojson = await response.json();
        dataLayer.addGeoJson(geojson);

        // Get neighborhood map for styling
        const neighborhoodMap = await getNeighborhoodMap();

        // Apply styles
        dataLayer.setStyle((feature: google.maps.Data.Feature) => {
          const districtId = feature.getId() as number;
          const neighborhood = neighborhoodMap.get(districtId);
          const healthScore = neighborhood?.health_score ?? 50;
          const color = getHealthScoreColor(healthScore);

          return {
            fillColor: color,
            fillOpacity: 0.7,
            strokeColor: '#333',
            strokeWeight: 2,
            strokeOpacity: selectedDistrict?.district_id === districtId ? 1 : 0.5,
            clickable: true,
          };
        });

        // Handle clicks
        dataLayer.addListener('click', (event: google.maps.Data.MouseEvent) => {
          const districtId = event.feature.getId() as number;
          const neighborhood = neighborhoodMap.get(districtId);
          if (neighborhood) {
            onDistrictSelect(neighborhood);
          }
        });

        // Handle mouseover/mouseout for visual feedback
        dataLayer.addListener('mouseover', (event: google.maps.Data.MouseEvent) => {
          dataLayer.overrideStyle(event.feature, { strokeWeight: 3 });
        });

        dataLayer.addListener('mouseout', (event: google.maps.Data.MouseEvent) => {
          dataLayer.revertStyle(event.feature);
        });

        setIsLoading(false);
      })
      .catch((error) => {
        console.error('Failed to load boundary data:', error);
        setIsLoading(false);
      });

    return () => {
      if (dataLayer) {
        dataLayer.setMap(null);
      }
      if (mapInstance) {
        mapInstance = null;
      }
    };
  }, [map, onDistrictSelect, selectedDistrict?.district_id]);

  // Redraw when selection changes
  useEffect(() => {
    if (dataLayerRef.current) {
      dataLayerRef.current.reloadGeoJson();
    }
  }, [selectedDistrict]);

  return (
    <div className="gmap-container" ref={mapRef}>
      {isLoading && (
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            zIndex: 100,
          }}
        >
          Loading map...
        </div>
      )}
    </div>
  );
}
