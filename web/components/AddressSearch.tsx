'use client';

import { useState, useRef, useEffect } from 'react';
import { resolveNeighborhoodForPoint, findNearestNamedPlace, searchPlaceIndex } from '@/lib/geo';
import type { Neighborhood } from '@/types/neighborhood';

interface SearchResult {
  name: string;
  lat: number;
  lon: number;
  display_name: string;
}

interface AddressSearchProps {
  onAddressSelect?: (
    address: string,
    lat: number,
    lon: number,
    district: Neighborhood | null,
    label: string,
    isNamedPlace: boolean
  ) => void;
  initialQuery?: string | null;
}

function shortLabel(result: SearchResult): { label: string; isNamedPlace: boolean } {
  if (result.name && result.name.trim().length > 0) {
    return { label: result.name.trim(), isNamedPlace: true };
  }
  // Nominatim puts the house number in its own field ("123, West 35th Street, ..."),
  // so join it with the street rather than labeling the place just "123".
  const parts = result.display_name.split(',').map((p) => p.trim());
  const label = /^\d+[A-Za-z]?$/.test(parts[0]) && parts[1] ? `${parts[0]} ${parts[1]}` : parts[0];
  return { label, isNamedPlace: false };
}

export default function AddressSearch({ onAddressSelect, initialQuery }: AddressSearchProps) {
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
      // Local named places (parks, businesses, buildings from the OSM
      // extract) are matched instantly with no network call and surfaced
      // first, since Nominatim's address-focused ranking often buries or
      // misses them entirely.
      const localMatches = await searchPlaceIndex(query, 5);

      // The place index only has an address when the OSM element itself
      // carried addr:housenumber/addr:street (see export_place_index.py) —
      // plenty of named amenities/shops don't. Backfill those via a reverse
      // geocode so results like "Nordstrom" show a street address too,
      // instead of just the bare name. Bounded to the handful of local
      // matches actually shown, not the whole 18k-entry index.
      const localMatchesWithAddress = await Promise.all(
        localMatches.map(async (m) => {
          if (m.address) return m;
          try {
            const r = await fetch(`/api/reverse-geocode?lat=${m.lat}&lon=${m.lon}`);
            const result = await r.json();
            const houseNumber = result?.address?.house_number;
            const road = result?.address?.road;
            const address = houseNumber && road ? `${houseNumber} ${road}` : road || null;
            return address ? { ...m, address } : m;
          } catch {
            return m;
          }
        })
      );

      const response = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`);
      const rawNominatimResults: SearchResult[] = await response.json();
      const nominatimResults = (Array.isArray(rawNominatimResults) ? rawNominatimResults : []).map((r) => ({
        ...r,
        lat: Number(r.lat),
        lon: Number(r.lon),
      }));

      // Both sources — and Nominatim on its own — can return several rows
      // for the literal same place (the building itself, an enclosing area,
      // a named point a few meters off). Group everything by name + ~60m
      // proximity and keep only the single most specific row per group (the
      // longest display_name, since that's the one carrying the fullest
      // address) instead of showing every near-duplicate.
      const distanceMeters = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
        const dLat = (a.lat - b.lat) * 111320;
        const dLon = (a.lon - b.lon) * 111320 * Math.cos((a.lat * Math.PI) / 180);
        return Math.sqrt(dLat * dLat + dLon * dLon);
      };

      const combined: SearchResult[] = [
        ...localMatchesWithAddress.map((m) => ({
          name: m.name,
          lat: m.lat,
          lon: m.lon,
          display_name: m.address ? `${m.name}, ${m.address}` : m.name,
        })),
        ...nominatimResults,
      ];

      const deduped: SearchResult[] = [];
      for (const candidate of combined) {
        const groupIdx = deduped.findIndex(
          (existing) =>
            existing.name?.trim().toLowerCase() === candidate.name?.trim().toLowerCase() &&
            distanceMeters(existing, candidate) < 60
        );
        if (groupIdx === -1) {
          deduped.push(candidate);
        } else if (candidate.display_name.length > deduped[groupIdx].display_name.length) {
          deduped[groupIdx] = candidate;
        }
      }

      // Nominatim's viewbox param is a soft hint, not a hard filter, so it
      // can still return points outside the mapped districts (a suburb, a
      // lake, a highway interchange) — those have no district/score data
      // and shouldn't be selectable here. Keep only results that resolve to
      // an actual St. Paul/Minneapolis district.
      const withinBounds = await Promise.all(
        deduped.map(async (r) => ((await resolveNeighborhoodForPoint(r.lat, r.lon)) ? r : null))
      );
      const inBoundsResults = withinBounds.filter((r): r is SearchResult => r !== null);

      if (inBoundsResults.length === 0) {
        setError('No location found within the mapped St. Paul/Minneapolis districts');
      }
      setSuggestions(inBoundsResults);
      return inBoundsResults;
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

    let { label, isNamedPlace } = shortLabel(result);
    // Nominatim's search result only carries its own `name` tag; if it has
    // none, check nearby buildings' addr:housename/operator tags too before
    // settling for the bare street address (same fallback as map clicks).
    if (!isNamedPlace) {
      const named = await findNearestNamedPlace(result.lat, result.lon);
      if (named) {
        label = named.name;
        isNamedPlace = true;
      }
    }
    const neighborhood = await resolveNeighborhoodForPoint(result.lat, result.lon);

    if (onAddressSelect) {
      onAddressSelect(result.display_name, result.lat, result.lon, neighborhood, label, isNamedPlace);
    }
  };

  // Deep link (?q=...), e.g. from the property-assessment site: search once
  // and select the top in-bounds match.
  useEffect(() => {
    if (!initialQuery) return;
    setSearchInput(initialQuery);
    searchAddresses(initialQuery).then((results) => {
      if (results && results.length > 0) handleSelectAddress(results[0]);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery]);

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
          placeholder="Search for an address"
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
