import type { Neighborhood, NeighborhoodsData } from '@/types/neighborhood';

const cachedData: Record<string, NeighborhoodsData> = {};
const cachedNeighborhoods: Record<string, Map<number, Neighborhood>> = {};

const CITY_FILES: Record<string, string> = {
  stpaul: '/data/neighborhoods.json',
  mpls: '/data/neighborhoods_mpls.json',
  zip: '/data/neighborhoods_zip.json',
};

export async function loadNeighborhoodData(city: string = 'stpaul'): Promise<NeighborhoodsData> {
  if (cachedData[city]) return cachedData[city];

  try {
    const response = await fetch(CITY_FILES[city] || CITY_FILES.stpaul);
    if (!response.ok) {
      throw new Error(`Failed to load neighborhoods for ${city}: ${response.status}`);
    }
    const data: NeighborhoodsData = await response.json();
    // Tag ZIP entries here (not just in getNeighborhoodMap) so every
    // consumer — including ones reading data.neighborhoods directly instead
    // of going through the Map — can tell a ZIP selection apart from a
    // district one, rather than misreading a 5-digit ZIP code as a
    // Minneapolis district id (which also happens to be >= 100). See
    // IndexComparisonChart's and NeighborhoodSidebar's district->city /
    // comparison-pool lookups.
    if (city === 'zip') {
      data.neighborhoods = data.neighborhoods.map((n) => ({ ...n, is_zip: true }));
    }
    cachedData[city] = data;
    return data;
  } catch (error) {
    console.error(`Error loading neighborhood data for ${city}:`, error);
    throw error;
  }
}

export async function getNeighborhoodMap(city: string = 'stpaul'): Promise<Map<number, Neighborhood>> {
  if (cachedNeighborhoods[city]) return cachedNeighborhoods[city];

  const data = await loadNeighborhoodData(city);
  const map = new Map(data.neighborhoods.map((n) => [n.district_id, n]));
  cachedNeighborhoods[city] = map;
  return map;
}

export async function getNeighborhoodById(districtId: number, city: string = 'stpaul'): Promise<Neighborhood | undefined> {
  const map = await getNeighborhoodMap(city);
  return map.get(districtId);
}
