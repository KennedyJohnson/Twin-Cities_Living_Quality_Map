'use client';

import { useState } from 'react';
import NeighborhoodMap from '@/components/NeighborhoodMap';
import NeighborhoodSidebar from '@/components/NeighborhoodSidebar';
import Legend from '@/components/Legend';
import type { Neighborhood } from '@/types/neighborhood';

export default function Home() {
  const [selectedDistrict, setSelectedDistrict] = useState<Neighborhood | null>(null);

  return (
    <div className="container">
      <div className="map-container">
        <NeighborhoodMap
          onDistrictSelect={setSelectedDistrict}
          selectedDistrict={selectedDistrict}
        />
        <Legend />
      </div>
      <NeighborhoodSidebar district={selectedDistrict} />
    </div>
  );
}
