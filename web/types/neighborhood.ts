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
