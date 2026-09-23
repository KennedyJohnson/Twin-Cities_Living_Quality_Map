import type { Neighborhood } from '@/types/neighborhood';
import { cityForDistrictId } from '@/lib/geo';

// Deep links into listing sites for the selected area. Zillow has no public
// listings API, but its search page accepts a `searchQueryState` JSON blob
// (map bounds + filters) in the URL, so we can open it zoomed to exactly the
// selected district/ZIP bounding box or 1-mile radius, pre-filtered to the
// user's Find Your Match budget. That format is undocumented and could
// change, so every area also gets a plain city/ZIP fallback link.

export interface Bounds {
  west: number;
  east: number;
  south: number;
  north: number;
}

const BOUNDARY_FILES = {
  stpaul: '/data/boundaries.geojson',
  mpls: '/data/boundaries_mpls.geojson',
  zip: '/data/boundaries_zip.geojson',
} as const;

const boundsCache: Partial<Record<keyof typeof BOUNDARY_FILES, Promise<Record<number, Bounds>>>> = {};

function extendBounds(b: Bounds, coords: any): void {
  if (typeof coords[0] === 'number') {
    const [lon, lat] = coords;
    b.west = Math.min(b.west, lon);
    b.east = Math.max(b.east, lon);
    b.south = Math.min(b.south, lat);
    b.north = Math.max(b.north, lat);
    return;
  }
  for (const c of coords) extendBounds(b, c);
}

function loadBounds(pool: keyof typeof BOUNDARY_FILES): Promise<Record<number, Bounds>> {
  if (!boundsCache[pool]) {
    boundsCache[pool] = fetch(BOUNDARY_FILES[pool])
      .then((r) => (r.ok ? r.json() : { features: [] }))
      .then((geo) => {
        const out: Record<number, Bounds> = {};
        for (const f of geo.features || []) {
          const id = Number(f.properties?.district_id);
          if (!Number.isFinite(id) || !f.geometry) continue;
          const b = out[id] ?? { west: Infinity, east: -Infinity, south: Infinity, north: -Infinity };
          extendBounds(b, f.geometry.coordinates);
          out[id] = b;
        }
        return out;
      })
      .catch(() => ({}));
  }
  return boundsCache[pool]!;
}

const METERS_PER_DEG_LAT = 111320;

export function boundsAroundPoint(lat: number, lon: number, radiusMeters = 1609): Bounds {
  const dLat = radiusMeters / METERS_PER_DEG_LAT;
  const dLon = radiusMeters / (METERS_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180));
  return { west: lon - dLon, east: lon + dLon, south: lat - dLat, north: lat + dLat };
}

// Bounding box for a district/ZIP selection, or the 1-mile square around a
// radius selection's center point.
export async function boundsForArea(
  district: Neighborhood,
  center?: { lat: number; lon: number } | null
): Promise<Bounds | null> {
  if (district.is_radius) return center ? boundsAroundPoint(center.lat, center.lon) : null;
  const pool = district.is_zip ? 'zip' : cityForDistrictId(district.district_id);
  const all = await loadBounds(pool);
  return all[district.district_id] ?? null;
}

export function boundsCenter(b: Bounds): { lat: number; lon: number } {
  return { lat: (b.south + b.north) / 2, lon: (b.west + b.east) / 2 };
}

export interface ListingFilters {
  maxRent: number | null;
  maxHomeValue: number | null;
  minBeds?: number | null;
  // Renter vs. buyer mode from Find Your Match — only that mode's Zillow
  // link is shown. Undefined shows both.
  mode?: 'rent' | 'buy';
  prefs?: ListingPrefs;
}

// Extra Zillow-only filters from Find Your Match. None of these affect our
// own area rankings — Census/OSM data has nothing on pets, laundry or HOAs.
export type HomeType = 'house' | 'townhome' | 'condo' | 'apartment' | 'multifamily';
export interface ListingPrefs {
  minBaths?: number | null;
  homeTypes?: HomeType[];
  // Rent-only
  pets?: ('largeDogs' | 'smallDogs' | 'cats')[];
  inUnitLaundry?: boolean;
  parking?: boolean;
  // Buy-only
  maxHoa?: number | null;
  minYearBuilt?: number | null;
}

// Zillow's home-type flags work by exclusion: every type defaults to on, and
// unchecked ones are sent as false.
const ZILLOW_HOME_TYPE_KEYS: Record<HomeType, string[]> = {
  house: ['sf'],
  townhome: ['tow'],
  condo: ['con'],
  apartment: ['apa', 'apco'],
  multifamily: ['mf'],
};
const ALL_ZILLOW_TYPE_KEYS = ['sf', 'tow', 'con', 'apa', 'apco', 'mf', 'manu', 'land'];

function prefsFilterState(kind: 'rent' | 'sale', p: ListingPrefs | undefined): Record<string, unknown> {
  if (!p) return {};
  const out: Record<string, unknown> = {};
  if (p.minBaths) out.baths = { min: p.minBaths };
  if (p.homeTypes && p.homeTypes.length > 0) {
    const keep = new Set(p.homeTypes.flatMap((t) => ZILLOW_HOME_TYPE_KEYS[t]));
    for (const k of ALL_ZILLOW_TYPE_KEYS) if (!keep.has(k)) out[k] = { value: false };
  }
  if (kind === 'rent') {
    if (p.pets?.includes('largeDogs')) out.ldog = { value: true };
    if (p.pets?.includes('smallDogs')) out.sdog = { value: true };
    if (p.pets?.includes('cats')) out.cat = { value: true };
    if (p.inUnitLaundry) out.lau = { value: true };
    if (p.parking) out.parka = { value: true };
  } else {
    if (p.maxHoa != null) out.hoa = { max: p.maxHoa };
    if (p.minYearBuilt) out.built = { min: p.minYearBuilt };
  }
  return out;
}

function zillowUrl(kind: 'rent' | 'sale', bounds: Bounds, filters: ListingFilters, searchTerm: string): string {
  const filterState: Record<string, unknown> =
    kind === 'rent'
      ? {
          fr: { value: true },
          fsba: { value: false },
          fsbo: { value: false },
          nc: { value: false },
          cmsn: { value: false },
          auc: { value: false },
          fore: { value: false },
          ...(filters.maxRent != null ? { mp: { max: filters.maxRent } } : {}),
        }
      : filters.maxHomeValue != null
      ? { price: { max: filters.maxHomeValue } }
      : {};
  if (filters.minBeds) filterState.beds = { min: filters.minBeds };
  Object.assign(filterState, prefsFilterState(kind, filters.prefs));
  const state = {
    pagination: {},
    usersSearchTerm: searchTerm,
    mapBounds: bounds,
    isMapVisible: true,
    isListVisible: true,
    filterState,
  };
  const path = kind === 'rent' ? 'for_rent' : 'for_sale';
  return `https://www.zillow.com/homes/${path}/?searchQueryState=${encodeURIComponent(JSON.stringify(state))}`;
}

export interface ListingLink {
  label: string;
  href: string;
}

export function listingLinks(
  district: Neighborhood,
  bounds: Bounds | null,
  filters: ListingFilters
): { primary: ListingLink[]; fallback: ListingLink[] } {
  const cityId = district.is_radius ? district.containing_district_id : district.district_id;
  const city = district.is_zip ? null : cityId != null ? cityForDistrictId(cityId) : null;
  const cityName = city === 'mpls' ? 'Minneapolis, MN' : city === 'stpaul' ? 'Saint Paul, MN' : 'Twin Cities, MN';
  const searchTerm = district.is_zip ? String(district.district_id) : cityName;

  const all: (ListingLink & { mode: 'rent' | 'buy' })[] = bounds
    ? [
        {
          label: filters.maxRent != null ? `Rentals under $${filters.maxRent.toLocaleString()}` : 'Rentals here',
          href: zillowUrl('rent', bounds, filters, searchTerm),
          mode: 'rent',
        },
        {
          label:
            filters.maxHomeValue != null
              ? `Homes for sale under $${filters.maxHomeValue.toLocaleString()}`
              : 'Homes for sale here',
          href: zillowUrl('sale', bounds, filters, searchTerm),
          mode: 'buy',
        },
      ]
    : [];
  const primary = all.filter((l) => !filters.mode || l.mode === filters.mode);

  const zillowSlug = district.is_zip
    ? String(district.district_id)
    : city === 'mpls'
    ? 'minneapolis-mn'
    : 'saint-paul-mn';
  const apartmentsSlug = city === 'mpls' ? 'minneapolis-mn' : 'saint-paul-mn';
  const fallback: ListingLink[] = [
    { label: `Zillow ${district.is_zip ? `ZIP ${district.district_id}` : cityName.replace(', MN', '')} rentals`, href: `https://www.zillow.com/${zillowSlug}/rentals/` },
  ];
  // Apartments.com's URL scheme needs a city slug, which a ZIP selection
  // doesn't carry, so it's only offered for district/radius selections.
  if (!district.is_zip) fallback.push({ label: 'Apartments.com', href: `https://www.apartments.com/${apartmentsSlug}/` });
  return { primary, fallback };
}
