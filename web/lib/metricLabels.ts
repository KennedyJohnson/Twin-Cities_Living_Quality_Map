export const metricLabels: Record<string, { label: string; unit: string }> = {
  crime_rate_pc: {
    label: 'Crime Rate',
    unit: 'incidents per 1,000 residents',
  },
  permit_rate_pc: {
    label: 'Permit Rate',
    unit: 'permits per 1,000 residents',
  },
  request_rate_pc: {
    label: 'Service Request Rate',
    unit: 'requests per 1,000 residents',
  },
  housing_rate_pc: {
    label: 'Housing Production Rate',
    unit: 'units per 1,000 residents',
  },
};

export function getMetricLabel(metricName: string): string {
  return metricLabels[metricName]?.label || metricName;
}

export function getMetricUnit(metricName: string): string {
  return metricLabels[metricName]?.unit || 'per 1,000 residents';
}

export const indexLabels: Record<string, string> = {
  safety: 'Safety Index',
  opportunity: 'Opportunity Index',
  quality_of_life: 'Quality of Life Index',
};
