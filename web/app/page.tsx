'use client';

import { useState } from 'react';
import { APIProvider } from '@vis.gl/react-google-maps';
import NeighborhoodMap from '@/components/NeighborhoodMap';
import NeighborhoodSidebar from '@/components/NeighborhoodSidebar';
import Legend from '@/components/Legend';
import type { Neighborhood } from '@/types/neighborhood';

export default function Home() {
  const [selectedDistrict, setSelectedDistrict] = useState<Neighborhood | null>(null);
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '';

  if (!apiKey) {
    return (
      <div className="container">
        <div style={{ padding: '40px', textAlign: 'center' }}>
          <h1>Configuration Required</h1>
          <p>Please set NEXT_PUBLIC_GOOGLE_MAPS_API_KEY in .env.local</p>
          <p style={{ marginTop: '10px', fontSize: '12px', color: '#999' }}>
            See .env.example for instructions
          </p>
        </div>
      </div>
    );
  }

  return (
    <APIProvider apiKey={apiKey}>
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
    </APIProvider>
  );
}
