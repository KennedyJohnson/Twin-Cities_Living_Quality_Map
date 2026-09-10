// Colorblind-safe, high-contrast palette (Okabe-Ito based) so each source
// is easy to tell apart at a glance. Building permits, service requests,
// and housing production are intentionally not point-layer sources (too
// granular / low user interest) — they still feed the health score, just
// aren't plotted.
export const POINT_LAYER_COLORS: Record<string, string> = {
  crime: '#d55e00',    // vermillion
  transit: '#56b4e9',  // sky blue
  schools: '#e69f00',  // orange
  groceries: '#000000', // black
  healthcare: '#009e73', // bluish green
  trails: '#5c3a00',   // dark brown
};

export const POINT_LAYER_ICONS: Record<string, string> = {
  crime: '🚨',
  transit: '🚌',
  schools: '🏫',
  groceries: '🛒',
  healthcare: '⚕️',
  trails: '🥾',
};

export const POINT_LAYER_LABELS: Record<string, string> = {
  crime: 'Crime Incidents (Minneapolis only)',
  transit: 'Transit Stops',
  schools: 'Schools',
  groceries: 'Grocery Stores',
  healthcare: 'Healthcare Facilities',
  trails: 'Trails / Paths',
};
