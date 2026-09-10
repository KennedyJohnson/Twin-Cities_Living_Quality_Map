export interface Metric {
  raw_count: number;
  rate_per_1000: number;
}

export interface Indices {
  safety: number;
  opportunity: number;
  quality_of_life: number;
  affordability?: number;
}

export interface Neighborhood {
  district_id: number;
  district_name: string;
  population: number;
  metrics: Record<string, Metric>;
  indices: Indices;
  health_score: number;
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
