export interface Metric {
  raw_count: number;
  rate_per_1000: number;
}

export interface Indices {
  safety?: number;
  opportunity?: number;
  quality_of_life?: number;
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
