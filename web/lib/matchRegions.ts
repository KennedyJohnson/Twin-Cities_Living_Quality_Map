// "Find Your Match" recommends areas, not specific listings (see MatchFinder.tsx):
// the top 5 districts that fit the user's weighted criteria and budget, each
// represented as a 1-mile-radius region centered on that district's
// highest-scoring apartment building. The center building is only a
// placement anchor — every apartment building inside the radius is shown as
// a clickable point so the user can explore the area themselves rather than
// being steered toward one listing.

export interface MatchRegionBuilding {
  id: string;
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
