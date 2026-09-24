import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Read-only browser client (publishable key; RLS allows public SELECT only).
// Null when the env vars aren't set, so Supabase-backed features just hide
// themselves instead of breaking the static-JSON map.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export const supabase: SupabaseClient | null =
  url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;

// Houses layer: below this zoom a viewport holds tens of thousands of houses,
// which would paint the map solid, so the layer stays empty until zoomed in.
export const HOUSES_MIN_ZOOM = 15;

export interface HouseRow {
  osm_id: string;
  building_type: string;
  address: string | null;
  lat: number;
  lon: number;
}

// houses_in_bbox() returns one JSON array of [osm_id, type, address, lat, lon]
// tuples (see supabase/migrations/20260923020000_houses_in_bbox_json.sql).
export async function fetchHousesInBbox(
  bbox: { minLon: number; minLat: number; maxLon: number; maxLat: number },
  maxRows = 5000
): Promise<HouseRow[] | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('houses_in_bbox', {
    min_lon: bbox.minLon, min_lat: bbox.minLat, max_lon: bbox.maxLon, max_lat: bbox.maxLat, max_rows: maxRows,
  });
  if (error || !Array.isArray(data)) return null;
  return (data as [string, string, string | null, number, number][]).map(([osm_id, building_type, address, lat, lon]) => ({
    osm_id, building_type, address, lat, lon,
  }));
}
