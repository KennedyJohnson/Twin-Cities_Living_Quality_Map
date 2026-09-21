export interface Metric {
  raw_count: number;
  rate_per_1000: number;
}

export interface Indices {
  safety?: number;
  opportunity?: number;
  amenities?: number;
  transportation?: number;
  affordability?: number;
  walkability_score?: number;
  commute_score?: number;
  education_score?: number;
  broadband_score?: number;
  // A future health-score component (see pipeline/config/weights.json)
  // shows up here under its own key without needing a type change.
  [key: string]: number | undefined;
}

export interface Neighborhood {
  district_id: number;
  district_name: string;
  population: number;
  metrics: Record<string, Metric>;
  indices: Indices;
  health_score: number;
  is_radius?: boolean;
  // For a radius/place selection (is_radius: true), the real district the
  // point falls within — there's no per-location history, so trend charts
  // fall back to this district's historical data as the closest available
  // proxy for "what has this area looked like over time."
  containing_district_id?: number;
  // True for a ZIP-granularity selection (district_id is a ZIP code, not a
  // St. Paul District Council / Minneapolis Community id) — set client-side
  // in loadNeighborhoodData.ts when loading the 'zip' pool, since ZIP codes
  // and district ids share the same numeric field but come from a
  // separately-normalized pool (see NeighborhoodMap.tsx's layerPoolsRef).
  is_zip?: boolean;
  // Full street address for a radius/place selection (is_radius: true),
  // shown under the location name in the sidebar. Not set for districts/ZIPs.
  address?: string;
}

export interface NeighborhoodsMetadata {
  total_districts: number;
  data_generated: string;
  note: string;
}

export interface NeighborhoodsData {
  neighborhoods: Neighborhood[];
  metadata: NeighborhoodsMetadata;
}

export interface BoundariesGeoJSON {
  type: 'FeatureCollection';
  features: GeoJSONFeature[];
}

export interface GeoJSONFeature {
  type: 'Feature';
  id: number;
  properties: {
    district_id: number;
    district_name: string;
  };
  geometry: {
    type: 'Polygon' | 'MultiPolygon';
    coordinates: number[][][] | number[][][][];
  };
}
