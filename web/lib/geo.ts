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
  const neighborhoodMap = await getNeighborhoodMap(cityForDistrictId(districtResult.districtId));
  return neighborhoodMap.get(districtResult.districtId) || null;
}

// Reverse-geocode a clicked map point to a short place label, via Nominatim
// (same OSM service AddressSearch uses for forward search).
// `isNamedPlace` is true only when Nominatim returned a real POI name (a
// business, park, etc.) rather than falling back to a bare street address or
// raw coordinates — those fallbacks aren't things Google Maps has a reviews
// page for, so callers use this to decide whether to show a reviews link.
export async function reverseGeocode(
  lat: number,
  lon: number
): Promise<{ label: string; isNamedPlace: boolean; address?: string }> {
  // Check the local named-place index first (see findNearestNamedPlace) —
  // it's already an in-memory static-file fetch, so this avoids a live
  // Nominatim call whenever the click already lands on/near a place we
  // indexed at build time.
  const nearby = await findNearestNamedPlace(lat, lon, 40);
  if (nearby) {
    return { label: nearby.name, isNamedPlace: true };
  }

  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=18`
    );
    const result = await response.json();
    if (result?.name && result.name.trim().length > 0) {
      return { label: result.name.trim(), isNamedPlace: true, address: result.display_name };
    }
    if (result?.display_name) {
      return { label: result.display_name.split(',')[0].trim(), isNamedPlace: false, address: result.display_name };
    }
  } catch (err) {
    console.error('Reverse geocode failed:', err);
  }
  return { label: `${lat.toFixed(5)}, ${lon.toFixed(5)}`, isNamedPlace: false };
}

interface PlaceIndexEntry {
  name: string;
  lat: number;
  lon: number;
  category: string | null;
  address: string | null;
}

let placeIndexCache: Promise<PlaceIndexEntry[]> | null = null;

// The named-place index is built once per pipeline run (see
// pipeline/exports/export_place_index.py) from the same local OSM extract the
// pipeline's other cleaners use, so this is a single static-file fetch
// instead of a live Overpass query — no per-click network round trip, no
// rate limiting, and it stays in sync with everything else the build derives
// from OSM.
function loadPlaceIndex(): Promise<PlaceIndexEntry[]> {
  if (!placeIndexCache) {
    placeIndexCache = fetch('/data/place_index.json')
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => []);
  }
  return placeIndexCache;
}

// Substring match against the local named-place index, for surfacing named
// places (parks, businesses, buildings) in address-search suggestions
// without waiting on/depending on Nominatim's ranking of them.
export async function searchPlaceIndex(query: string, limit = 5): Promise<PlaceIndexEntry[]> {
  const q = query.trim().toLowerCase();
  if (q.length < 3) return [];
  const places = await loadPlaceIndex();
  const matches = places.filter((p) => p.name.toLowerCase().includes(q));
  return matches.slice(0, limit);
}

function distanceMeters(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const dLat = (a.lat - b.lat) * 111320;
  const dLon = (a.lon - b.lon) * 111320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.sqrt(dLat * dLat + dLon * dLon);
}

// Look for a named place (building, shop, amenity, park) near a clicked
// point using the local place index. Prefers ANY named place within
// radiusMeters over the literal nearest building, since a complex's name is
// often tagged on a separate node/way (e.g. a sign or office) from the
// addressed residential building Nominatim's reverse lookup snaps to.
// Returns null if nothing indexed nearby.
export async function findNearestNamedPlace(
  lat: number,
  lon: number,
  radiusMeters = 80
): Promise<{ name: string; lat: number; lon: number } | null> {
  try {
    const places = await loadPlaceIndex();
    let nearest: { name: string; lat: number; lon: number } | null = null;
    let nearestDist = Infinity;
    for (const place of places) {
      const dist = distanceMeters({ lat, lon }, place);
      if (dist <= radiusMeters && dist < nearestDist) {
        nearestDist = dist;
        nearest = { name: place.name, lat: place.lat, lon: place.lon };
      }
    }
    return nearest;
  } catch (err) {
    console.error('Named-place lookup failed:', err);
    return null;
  }
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
