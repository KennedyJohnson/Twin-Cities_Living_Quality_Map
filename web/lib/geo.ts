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

async function findDistrictInFile(
  url: string,
  point: { coordinates: [number, number] }
): Promise<PointInPolygonResult | null> {
  const response = await fetch(url);
  if (!response.ok) return null;
  const geojson = await response.json();

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
}

export async function findDistrictForPoint(
  lat: number,
  lon: number
): Promise<PointInPolygonResult | null> {
  try {
    const point = { coordinates: [lon, lat] as [number, number] };
    const stpaulResult = await findDistrictInFile('/data/boundaries.geojson', point);
    if (stpaulResult) return stpaulResult;
    return await findDistrictInFile('/data/boundaries_mpls.geojson', point);
  } catch (err) {
    console.error('Error finding district:', err);
    return null;
  }
}

// district_id ranges (1-17 = St. Paul, 101-111 = Minneapolis) distinguish the
// two cities' data files everywhere in the pipeline/frontend.
export function cityForDistrictId(districtId: number): 'stpaul' | 'mpls' {
  return districtId >= 100 ? 'mpls' : 'stpaul';
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

// Snap a clicked point to the centroid of the nearest OSM building, store,
// or park within ~40m, so a slightly-off click still lands on the place the
// user meant. Deliberately excludes roads/paths (highway=*) — only tagged
// places (buildings, shops, amenities, parks) count as snap targets. Falls
// back to the original point if nothing is found nearby.
export async function snapToNearestBuilding(lat: number, lon: number): Promise<{ lat: number; lon: number }> {
  const radiusMeters = 40;
  const around = `(around:${radiusMeters},${lat},${lon})`;
  const query = `[out:json][timeout:5];(
    way["building"]${around};
    way["shop"]${around};
    node["shop"]${around};
    way["amenity"]${around};
    node["amenity"]${around};
    way["leisure"~"^(park|garden|nature_reserve|playground)$"]${around};
    relation["leisure"~"^(park|garden|nature_reserve|playground)$"]${around};
  );out geom center;`;

  try {
    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: `data=${encodeURIComponent(query)}`,
    });
    if (!response.ok) return { lat, lon };
    const result = await response.json();
    const elements: {
      type: string;
      lat?: number;
      lon?: number;
      center?: { lat: number; lon: number };
      geometry?: { lat: number; lon: number }[];
    }[] = result?.elements || [];
    if (elements.length === 0) return { lat, lon };

    const distanceMeters = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
      const dLat = (a.lat - b.lat) * 111320;
      const dLon = (a.lon - b.lon) * 111320 * Math.cos((a.lat * Math.PI) / 180);
      return Math.sqrt(dLat * dLat + dLon * dLon);
    };

    let nearest: { lat: number; lon: number } | null = null;
    let nearestDist = Infinity;
    for (const el of elements) {
      let point: { lat: number; lon: number } | null = null;
      if (el.type === 'node' && el.lat != null && el.lon != null) {
        point = { lat: el.lat, lon: el.lon };
      } else if (el.center) {
        point = el.center;
      } else if (el.geometry && el.geometry.length > 0) {
        const geom = el.geometry;
        point = {
          lat: geom.reduce((s, p) => s + p.lat, 0) / geom.length,
          lon: geom.reduce((s, p) => s + p.lon, 0) / geom.length,
        };
      }
      if (!point) continue;
      const dist = distanceMeters({ lat, lon }, point);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = point;
      }
    }
    return nearest || { lat, lon };
  } catch (err) {
    console.error('Building snap failed:', err);
    return { lat, lon };
  }
}

export function googleMapsSearchUrl(lat: number, lon: number, label?: string): string {
  const query = label ? `${label} @${lat},${lon}` : `${lat},${lon}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}
