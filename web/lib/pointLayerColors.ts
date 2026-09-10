// Colorblind-safe, high-contrast palette (Okabe-Ito based) so each source
// is easy to tell apart at a glance (e.g. permits vs. requests).
export const POINT_LAYER_COLORS: Record<string, string> = {
  crime: '#d55e00',    // vermillion
  permits: '#0072b2',  // blue
  requests: '#cc79a7', // pink/magenta
  housing: '#009e73',  // green
  transit: '#56b4e9',  // sky blue
  schools: '#e69f00',  // orange
  trails: '#5c3a00',   // dark brown
};

export const POINT_LAYER_LABELS: Record<string, string> = {
  crime: 'Crime Incidents',
  permits: 'Building Permits',
  requests: 'Service Requests',
  housing: 'Housing Production',
  transit: 'Transit Stops',
  schools: 'Schools',
  trails: 'Trails / Paths',
};
