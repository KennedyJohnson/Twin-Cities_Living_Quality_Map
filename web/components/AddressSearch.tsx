'use client';

import { useState, useRef, useEffect } from 'react';
import { resolveNeighborhoodForPoint } from '@/lib/geo';
import type { Neighborhood } from '@/types/neighborhood';

interface SearchResult {
  name: string;
  lat: number;
  lon: number;
  display_name: string;
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

  const handleSelectAddress = async (result: SearchResult) => {
    setSearchInput(result.display_name);
    setSelectedAddress(result.display_name);
    setSuggestions([]);

    const label = shortLabel(result);
    const neighborhood = await resolveNeighborhoodForPoint(result.lat, result.lon);

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
