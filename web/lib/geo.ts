import { getNeighborhoodMap } from '@/lib/loadNeighborhoodData';
import type { Neighborhood } from '@/types/neighborhood';

interface PointInPolygonResult {
  districtId: number;
  districtName: string;
}

function pointInPolygon(point: { coordinates: [number, number] }, feature: any): boolean {
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
}

export async function findDistrictForPoint(
  lat: number,
  lon: number
): Promise<PointInPolygonResult | null> {
  try {
    const response = await fetch('/data/boundaries.geojson');
    const geojson = await response.json();

    const point = { coordinates: [lon, lat] as [number, number] };

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
}

export async function resolveNeighborhoodForPoint(lat: number, lon: number): Promise<Neighborhood | null> {
  const districtResult = await findDistrictForPoint(lat, lon);
  if (!districtResult) return null;
  const neighborhoodMap = await getNeighborhoodMap();
  return neighborhoodMap.get(districtResult.districtId) || null;
}

// Reverse-geocode a clicked map point to a short place label, via Nominatim
// (same OSM service AddressSearch uses for forward search).
export async function reverseGeocode(lat: number, lon: number): Promise<string> {
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=18`
    );
    const result = await response.json();
    if (result?.name && result.name.trim().length > 0) {
      return result.name.trim();
    }
    if (result?.display_name) {
      return result.display_name.split(',')[0].trim();
    }
  } catch (err) {
    console.error('Reverse geocode failed:', err);
  }
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

export function googleMapsSearchUrl(lat: number, lon: number, label?: string): string {
  const query = label ? `${label} @${lat},${lon}` : `${lat},${lon}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}
