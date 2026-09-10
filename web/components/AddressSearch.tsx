'use client';

import { useState, useRef, useEffect } from 'react';
import { getNeighborhoodMap } from '@/lib/loadNeighborhoodData';
import type { Neighborhood } from '@/types/neighborhood';

interface SearchResult {
  name: string;
  lat: number;
  lon: number;
  display_name: string;
}

interface PointInPolygonResult {
  districtId: number;
  districtName: string;
}

interface AddressSearchProps {
  onAddressSelect?: (address: string, lat: number, lon: number, district: Neighborhood | null, label: string) => void;
}

function shortLabel(result: SearchResult): string {
  if (result.name && result.name.trim().length > 0) {
    return result.name.trim();
  }
  return result.display_name.split(',')[0].trim();
}

export default function AddressSearch({ onAddressSelect }: AddressSearchProps) {
  const [searchInput, setSearchInput] = useState('');
  const [suggestions, setSuggestions] = useState<SearchResult[]>([]);
  const [selectedAddress, setSelectedAddress] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const suggestionsRef = useRef<HTMLDivElement | null>(null);

  // Debounce search
  const debounceTimer = useRef<NodeJS.Timeout>();

  const searchAddresses = async (query: string) => {
    if (!query || query.length < 3) {
      setSuggestions([]);
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
          query
        )}&bounded=1&viewbox=-93.4,44.8,-92.8,45.1&limit=10`
      );

      const results: SearchResult[] = await response.json();
      setSuggestions(results);
    } catch (err) {
      setError('Failed to search addresses');
      setSuggestions([]);
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchInput(value);

    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }

    debounceTimer.current = setTimeout(() => {
      searchAddresses(value);
    }, 300);
  };

  const findDistrictForPoint = async (
    lat: number,
    lon: number
  ): Promise<PointInPolygonResult | null> => {
    try {
      const response = await fetch('/data/boundaries.geojson');
      const geojson = await response.json();
      const neighborhoodMap = await getNeighborhoodMap();

      const point = { type: 'Point', coordinates: [lon, lat] };

      for (const feature of geojson.features) {
        if (pointInPolygon(point, feature)) {
          const districtId = feature.id || feature.properties.district_id;
          return {
            districtId,
            districtName: feature.properties.district_name,
          };
        }
      }

      return null;
    } catch (err) {
      console.error('Error finding district:', err);
      return null;
    }
  };

  const pointInPolygon = (point: any, feature: any): boolean => {
    const [lon, lat] = point.coordinates;
    const coords = feature.geometry.coordinates[0]; // First ring of polygon

    let inside = false;
    for (let i = 0, j = coords.length - 1; i < coords.length; j = i++) {
      const xi = coords[i][0];
      const yi = coords[i][1];
      const xj = coords[j][0];
      const yj = coords[j][1];

      const intersect = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  };

  const handleSelectAddress = async (result: SearchResult) => {
    setSearchInput(result.display_name);
    setSelectedAddress(result.display_name);
    setSuggestions([]);

    const label = shortLabel(result);
    const districtResult = await findDistrictForPoint(result.lat, result.lon);
    let neighborhood: Neighborhood | null = null;
    if (districtResult) {
      const neighborhoodMap = await getNeighborhoodMap();
      neighborhood = neighborhoodMap.get(districtResult.districtId) || null;
    }

    if (onAddressSelect) {
      onAddressSelect(result.display_name, result.lat, result.lon, neighborhood, label);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (suggestions.length > 0) {
      handleSelectAddress(suggestions[0]);
    }
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (suggestionsRef.current && !suggestionsRef.current.contains(e.target as Node)) {
        setSuggestions([]);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="address-search">
      <form onSubmit={handleSearch}>
        <input
          type="text"
          placeholder="Search for an address in the Twin Cities..."
          value={searchInput}
          onChange={handleInputChange}
          className="search-input"
        />
        <button type="submit" className="search-button">
          Search
        </button>
      </form>

      {suggestions.length > 0 && (
        <div className="suggestions" ref={suggestionsRef}>
          {suggestions.map((result, idx) => (
            <div
              key={idx}
              className="suggestion-item"
              onClick={() => handleSelectAddress(result)}
            >
              <div className="suggestion-name">{result.display_name}</div>
            </div>
          ))}
        </div>
      )}

      {error && <div className="search-error">{error}</div>}
      {loading && <div className="search-loading">Searching...</div>}
    </div>
  );
}
