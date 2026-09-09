'use client';

import { useEffect, useRef, useState } from 'react';
import { MapContainer, TileLayer, GeoJSON, useMap } from 'react-leaflet';
import L from 'leaflet';
import { getHealthScoreColor } from '@/lib/ColorScale';
import { loadNeighborhoodData, getNeighborhoodMap } from '@/lib/loadNeighborhoodData';
import type { Neighborhood } from '@/types/neighborhood';
import 'leaflet/dist/leaflet.css';

interface NeighborhoodMapProps {
  onDistrictSelect: (district: Neighborhood | null) => void;
  selectedDistrict: Neighborhood | null;
  flyToLocation?: { lat: number; lon: number } | null;
}

function MapContent({
  onDistrictSelect,
  selectedDistrict,
  flyToLocation,
}: NeighborhoodMapProps) {
  const map = useMap();
  const geoJsonRef = useRef<L.GeoJSON | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadMap = async () => {
      try {
        await loadNeighborhoodData();
        const response = await fetch('/data/boundaries.geojson');
        const geojson = await response.json();
        const neighborhoodMap = await getNeighborhoodMap();

        const geoJsonLayer = L.geoJSON(geojson, {
          style: (feature) => {
            const districtId = (feature?.id || feature?.properties?.district_id) as number;
            const neighborhood = neighborhoodMap.get(districtId);
            const healthScore = neighborhood?.health_score ?? 50;
            const color = getHealthScoreColor(healthScore);

            return {
              fillColor: color,
              fillOpacity: 0.7,
              color: '#333',
              weight: selectedDistrict?.district_id === districtId ? 3 : 2,
              opacity: selectedDistrict?.district_id === districtId ? 1 : 0.5,
            };
          },
          onEachFeature: (feature, layer) => {
            const districtId = (feature?.id || feature?.properties?.district_id) as number;
            const neighborhood = neighborhoodMap.get(districtId);

            if (neighborhood) {
              layer.on('click', () => {
                onDistrictSelect(neighborhood);
              });

              layer.on('mouseover', () => {
                (layer as L.Path).setStyle({ weight: 3, opacity: 1 });
              });

              layer.on('mouseout', () => {
                const isSelected = selectedDistrict?.district_id === districtId;
                (layer as L.Path).setStyle({
                  weight: isSelected ? 3 : 2,
                  opacity: isSelected ? 1 : 0.5,
                });
              });
            }
          },
        });

        geoJsonRef.current = geoJsonLayer;
        geoJsonLayer.addTo(map);

        // Fit map bounds to Twin Cities metro area
        const bounds = L.latLngBounds([
          [44.8, -93.4],   // Southwest corner
          [45.1, -92.8],   // Northeast corner
        ]);
        map.fitBounds(bounds, { padding: [50, 50] });

        setIsLoading(false);
      } catch (error) {
        console.error('Failed to load boundary data:', error);
        setIsLoading(false);
      }
    };

    loadMap();
  }, [map, onDistrictSelect]);

  useEffect(() => {
    if (geoJsonRef.current) {
      geoJsonRef.current.eachLayer((layer: L.Layer) => {
        if (layer instanceof L.Path) {
          const feature = (layer as any).feature;
          const districtId = (feature?.id || feature?.properties?.district_id) as number;
          const isSelected = selectedDistrict?.district_id === districtId;

          layer.setStyle({
            weight: isSelected ? 3 : 2,
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

export default function NeighborhoodMap({
  onDistrictSelect,
  selectedDistrict,
  flyToLocation,
}: NeighborhoodMapProps) {
  return (
    <MapContainer
      center={[44.9537, -93.094]}
      zoom={11}
      className="gmap-container"
      style={{ height: '100%', width: '100%' }}
    >
      <MapContent
        onDistrictSelect={onDistrictSelect}
        selectedDistrict={selectedDistrict}
        flyToLocation={flyToLocation}
      />
    </MapContainer>
  );
}
