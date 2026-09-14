// Colorblind-safe, high-contrast palette (Okabe-Ito based) so each source
// is easy to tell apart at a glance. Building permits are intentionally not
// a point-layer source (too granular / low user interest) — it still feeds
// the health score, just isn't plotted. Service requests and housing
// production were removed from the health score entirely (see weights.json)
// due to data-comparability problems between the two cities' source
// datasets, so neither is plotted or scored anymore.
export const POINT_LAYER_COLORS: Record<string, string> = {
  crime: '#d55e00',    // vermillion
  crashes: '#e31a1c',  // red
  transit: '#56b4e9',  // sky blue
  schools: '#e69f00',  // orange
  groceries: '#000000', // black
  healthcare: '#009e73', // bluish green
  restaurants: '#cc79a7', // reddish purple
  entertainment: '#0072b2', // blue
  trails: '#5c3a00',   // dark brown
};

export const POINT_LAYER_ICONS: Record<string, string> = {
  crime: '🚨',
  crashes: '⚠️',
  transit: '🚌',
  schools: '🏫',
  groceries: '🛒',
  healthcare: '⚕️',
  restaurants: '🍽️',
  entertainment: '🎭',
  trails: '🥾',
};

// Sources with more points than this render on the map as plain canvas dots
// instead of the emoji pin icon, to keep panning smooth (see
// NeighborhoodMap.tsx). Shared here so the legend swatch can match. Set to 0
// so every point layer (all sources except trails, which are lines, not
// markers) always renders as canvas dots, matching crime/transit.
export const CANVAS_MARKER_THRESHOLD = 0;

export const POINT_LAYER_LABELS: Record<string, string> = {
  crime: 'Crime Incidents',
  crashes: 'Pedestrian/Cyclist Crashes',
  transit: 'Transit Stops',
  schools: 'Schools',
  groceries: 'Grocery Stores',
  healthcare: 'Healthcare Facilities',
  restaurants: 'Restaurants / Bars',
  entertainment: 'Entertainment Venues',
  trails: 'Trails / Paths',
};
