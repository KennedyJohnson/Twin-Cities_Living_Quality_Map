export interface DistrictBudget {
  median_home_value: number;
  median_gross_rent: number;
}

// district_id is unique across both cities already (St. Paul 1-17,
// Minneapolis 101-111), so both files merge into one flat lookup.
const AFFORDABILITY_FILES = ['/data/affordability_stpaul.json', '/data/affordability_mpls.json'];

// Single source of truth for "does this district fit the budget" — used both
// to gray out districts on the map and to filter the Match Finder's ranked
// list, so the two views can't silently drift apart from each other.
export function isWithinBudget(
  budget: DistrictBudget | undefined,
  maxRent: number | null,
  maxHomeValue: number | null
): boolean {
  if (maxRent !== null && budget?.median_gross_rent !== undefined && budget.median_gross_rent > maxRent) {
    return false;
  }
  if (maxHomeValue !== null && budget?.median_home_value !== undefined && budget.median_home_value > maxHomeValue) {
    return false;
  }
  return true;
}

let cached: Record<number, DistrictBudget> | null = null;

export async function loadBudgetData(): Promise<Record<number, DistrictBudget>> {
  if (cached) return cached;

  const result: Record<number, DistrictBudget> = {};
  await Promise.all(
    AFFORDABILITY_FILES.map(async (url) => {
      try {
        const res = await fetch(url);
        if (!res.ok) return;
        const data = await res.json();
        for (const [id, d] of Object.entries<any>(data.districts || {})) {
          result[Number(id)] = {
            median_home_value: d.median_home_value,
            median_gross_rent: d.median_gross_rent,
          };
        }
      } catch (err) {
        console.error(`Failed to load budget data from ${url}:`, err);
      }
    })
  );

  cached = result;
  return result;
}
