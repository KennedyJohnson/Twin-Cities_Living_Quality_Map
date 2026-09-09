'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import NeighborhoodSidebar from '@/components/NeighborhoodSidebar';
import AddressSearch from '@/components/AddressSearch';
import Legend from '@/components/Legend';
import type { Neighborhood } from '@/types/neighborhood';

const NeighborhoodMap = dynamic(() => import('@/components/NeighborhoodMap'), {
  ssr: false,
  loading: () => <div>Loading map...</div>,
});

export default function Home() {
  const [selectedDistrict, setSelectedDistrict] = useState<Neighborhood | null>(null);
  const [flyToLocation, setFlyToLocation] = useState<{ lat: number; lon: number } | null>(null);

  const handleAddressSelect = (address: string, lat: number, lon: number, district: Neighborhood | null) => {
    setSelectedDistrict(district);
    setFlyToLocation({ lat, lon });
  };

  return (
    <div className="container">
      <div className="map-container">
        <NeighborhoodMap
          onDistrictSelect={setSelectedDistrict}
          selectedDistrict={selectedDistrict}
          flyToLocation={flyToLocation}
        />
        <Legend />
        <AddressSearch onAddressSelect={handleAddressSelect} />
      </div>
      <NeighborhoodSidebar district={selectedDistrict} />
    </div>
  );
}
