'use client';

import { useEffect, useState } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend as RechartsLegend,
  ResponsiveContainer,
} from 'recharts';

interface CitywideSeries {
  years: number[];
  crime: number[];
  permits: number[];
  requests: number[];
  housing: number[];
}

const MIN_YEAR = 2015;
const CURRENT_YEAR = new Date().getFullYear();

const METRIC_LABELS: Record<string, string> = {
  crime: 'Crime Incidents',
  permits: 'Building Permits',
  requests: 'Service Requests',
  housing: 'Housing Production',
};

const METRIC_COLORS: Record<string, string> = {
  crime: '#d55e00',
  permits: '#0072b2',
  requests: '#cc79a7',
  housing: '#009e73',
};

// Housing Production runs orders of magnitude smaller than the other
// metrics it's charted alongside (Service Requests) — give it its own
// right-hand axis so it isn't flattened to a near-zero line.
const SECONDARY_AXIS_METRICS = new Set(['housing']);

interface TimeSeriesChartProps {
  city: 'stpaul' | 'mpls';
  cityLabel: string;
  metrics: (keyof Omit<CitywideSeries, 'years'>)[];
}

export default function TimeSeriesChart({ city, cityLabel, metrics }: TimeSeriesChartProps) {
  const [data, setData] = useState<CitywideSeries | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch(`/data/timeseries_${city}.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((json) => setData(json.citywide))
      .catch(() => setError(true));
  }, [city]);

  if (error) {
    return <div style={{ color: '#999', fontSize: '13px' }}>Time-series data unavailable for {cityLabel}.</div>;
  }

  if (!data) {
    return <div style={{ color: '#999', fontSize: '13px' }}>Loading {cityLabel} trends…</div>;
  }

  const chartData = data.years
    .map((year, i) => {
      const row: Record<string, number> = { year };
      for (const metric of metrics) {
        row[METRIC_LABELS[metric]] = data[metric][i];
      }
      return row;
    })
    // Drop years before real data coverage starts, and the current year
    // (its count is a partial-year total, not comparable to full years).
    .filter((row) => row.year >= MIN_YEAR && row.year < CURRENT_YEAR);

  const hasSecondaryAxis = metrics.some((m) => SECONDARY_AXIS_METRICS.has(m));

  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" />
        <XAxis dataKey="year" tick={{ fontSize: 12 }} />
        <YAxis yAxisId="left" tick={{ fontSize: 12 }} width={60} />
        {hasSecondaryAxis && <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 12 }} width={50} />}
        <Tooltip />
        <RechartsLegend />
        {metrics.map((metric) => (
          <Line
            key={metric}
            yAxisId={SECONDARY_AXIS_METRICS.has(metric) ? 'right' : 'left'}
            type="monotone"
            dataKey={METRIC_LABELS[metric]}
            stroke={METRIC_COLORS[metric]}
            strokeWidth={2}
            dot={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
