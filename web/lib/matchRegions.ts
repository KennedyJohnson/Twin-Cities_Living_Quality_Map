// "Find Your Match" recommends areas, not specific listings (see MatchFinder.tsx):
// the top 5 districts that fit the user's weighted criteria and budget, each
// represented as a 1-mile-radius region centered on that district's
// highest-scoring apartment building. The center building is only a
// placement anchor — every apartment building inside the radius is shown as
// a clickable point so the user can explore the area themselves rather than
// being steered toward one listing.

import { fetchHousesInBbox } from '@/lib/supabase';
import type { HomeType } from '@/lib/listingLinks';

export interface MatchRegionBuilding {
  id: string;
  // 'house' = OSM house-type building from Supabase (see housesInRegion);
  // absent/'apartment' = apartment_buildings_{city}.json record.
  kind?: 'apartment' | 'house';
  name: string;
  address: string | null;
  lat: number;
  lon: number;
}

export interface MatchRegion {
  id: string;
  rank: number;
  districtId: number;
  districtName: string;
  center: { lat: number; lon: number };
  radiusMeters: number;
  districtScore: number;
  buildings: MatchRegionBuilding[];
}

export const MATCH_REGION_RADIUS_METERS = 1609.34;

const EARTH_RADIUS_METERS = 6371000;

export function haversineMeters(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Which OSM building= tags (houses table, pipeline/exports/export_houses_supabase.py)
// satisfy each Find Your Match home-type checkbox. No selection = everything.
const OSM_HOUSE_TYPES: Record<HomeType, string[]> = {
  // inferred_house = untagged building=yes with a house-sized footprint.
  house: ['house', 'detached', 'bungalow', 'inferred_house'],
  townhome: ['terrace'],
  multifamily: ['semidetached_house'],
  condo: [],
  apartment: [],
};

export function houseTypesFor(homeTypes: HomeType[] | undefined): string[] {
  if (!homeTypes || homeTypes.length === 0) return Object.values(OSM_HOUSE_TYPES).flat();
  return Array.from(new Set(homeTypes.flatMap((t) => OSM_HOUSE_TYPES[t])));
}

// Apartment-building records cover both rentals and condo buildings.
export function includesApartments(homeTypes: HomeType[] | undefined): boolean {
  return !homeTypes || homeTypes.length === 0 || homeTypes.includes('apartment') || homeTypes.includes('condo');
}

// Houses of the given OSM types within a region's radius, via the
// houses_in_bbox() PostGIS RPC. Empty if Supabase isn't configured.
export async function housesInRegion(
  center: { lat: number; lon: number },
  radiusMeters: number,
  osmTypes: string[]
): Promise<MatchRegionBuilding[]> {
  if (osmTypes.length === 0) return [];
  const dLat = radiusMeters / 111320;
  const dLon = radiusMeters / (111320 * Math.cos((center.lat * Math.PI) / 180));
  const data = await fetchHousesInBbox(
    { minLon: center.lon - dLon, minLat: center.lat - dLat, maxLon: center.lon + dLon, maxLat: center.lat + dLat },
    20000
  );
  if (!data) return [];
  const wanted = new Set(osmTypes);
  return data
    .filter((h) => wanted.has(h.building_type) && haversineMeters(center.lat, center.lon, h.lat, h.lon) <= radiusMeters)
    .map((h) => ({ id: h.osm_id, kind: 'house' as const, name: h.address || (h.building_type === 'inferred_house' ? 'Likely house' : 'House'), address: h.address, lat: h.lat, lon: h.lon }));
}
