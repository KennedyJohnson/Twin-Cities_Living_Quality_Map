import type { Neighborhood, NeighborhoodsData } from '@/types/neighborhood';

let cachedData: NeighborhoodsData | null = null;
let cachedNeighborhoods: Map<number, Neighborhood> | null = null;

export async function loadNeighborhoodData(): Promise<NeighborhoodsData> {
  if (cachedData) return cachedData;

  try {
    const response = await fetch('/data/neighborhoods.json');
    if (!response.ok) {
      throw new Error(`Failed to load neighborhoods: ${response.status}`);
    }
    const data: NeighborhoodsData = await response.json();
    cachedData = data;
    return data;
  } catch (error) {
    console.error('Error loading neighborhood data:', error);
    throw error;
  }
}

export async function getNeighborhoodMap(): Promise<Map<number, Neighborhood>> {
  if (cachedNeighborhoods) return cachedNeighborhoods;

  const data = await loadNeighborhoodData();
  cachedNeighborhoods = new Map(
    data.neighborhoods.map(n => [n.district_id, n])
  );
  return cachedNeighborhoods;
}

export async function getNeighborhoodById(districtId: number): Promise<Neighborhood | undefined> {
  const map = await getNeighborhoodMap();
  return map.get(districtId);
}
