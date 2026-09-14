'use client';

import { useEffect, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface CitywideSeries {
  years: number[];
  crime: number[];
  permits: number[];
  requests: number[];
  housing: number[];
  population: number;
}

const MIN_YEAR = 2015;
const CURRENT_YEAR = new Date().getFullYear();

const METRIC_LABELS: Record<string, string> = {
  crime: 'Crime Incidents',
  permits: 'Building Permits',
  requests: 'Service Requests',
  housing: 'Housing Production',
};

const CITY_COLORS: Record<'stpaul' | 'mpls', string> = {
  stpaul: '#756bb1',
  mpls: '#31a354',
};

const CITY_LABELS: Record<'stpaul' | 'mpls', string> = {
  stpaul: 'St. Paul',
  mpls: 'Minneapolis',
};

interface TimeSeriesComparisonChartProps {
  metric: keyof Omit<CitywideSeries, 'years' | 'population'>;
}

export default function TimeSeriesComparisonChart({ metric }: TimeSeriesComparisonChartProps) {
  const [chartData, setChartData] = useState<Record<string, number | null>[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    Promise.all(
      (['stpaul', 'mpls'] as const).map((city) =>
        fetch(`/data/timeseries_${city}.json`).then((r) => (r.ok ? r.json() : Promise.reject()))
      )
    )
      .then(([stpaul, mpls]: { citywide: CitywideSeries }[]) => {
        const stpaulData = stpaul.citywide;
        const mplsData = mpls.citywide;
        const stpaulPop = stpaulData.population;
        const mplsPop = mplsData.population;
        const years = Array.from(new Set([...stpaulData.years, ...mplsData.years])).sort((a, b) => a - b);
        const points = years
          .map((year) => {
            const si = stpaulData.years.indexOf(year);
            const mi = mplsData.years.indexOf(year);
            const stpaulCount = si >= 0 ? stpaulData[metric][si] : null;
            const mplsCount = mi >= 0 ? mplsData[metric][mi] : null;
            return {
              year,
              [CITY_LABELS.stpaul]: stpaulCount !== null ? (stpaulCount / stpaulPop) * 1000 : null,
              [CITY_LABELS.mpls]: mplsCount !== null ? (mplsCount / mplsPop) * 1000 : null,
            };
          })
          .filter((row) => row.year >= MIN_YEAR && row.year < CURRENT_YEAR);
        setChartData(points);
      })
      .catch(() => setError(true));
  }, [metric]);

  if (error) {
    return <div style={{ color: '#999', fontSize: '13px' }}>Time-series data unavailable.</div>;
  }

  if (!chartData) {
    return <div style={{ color: '#999', fontSize: '13px' }}>Loading trends…</div>;
  }

  const caption = describeTrend(chartData, metric);

  const allValues = chartData.flatMap((row) =>
    (['stpaul', 'mpls'] as const).map((c) => row[CITY_LABELS[c]]).filter((v): v is number => v != null)
  );
  const rawMin = allValues.length ? Math.min(...allValues) : 0;
  const rawMax = allValues.length ? Math.max(...allValues) : 1;
  const padding = Math.max((rawMax - rawMin) * 0.1, 0.1);
  const domainMin = rawMin - padding;
  const domainMax = rawMax + padding;
  const TICK_COUNT = 5;
  const rawTickStep = (domainMax - domainMin) / (TICK_COUNT - 1);
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawTickStep)));
  const niceSteps = [1, 2, 2.5, 5, 10];
  const tickStep = niceSteps.find((s) => s * magnitude >= rawTickStep)! * magnitude;
  const domainMinRounded = Math.floor(domainMin / tickStep) * tickStep;
  const yTicks = Array.from({ length: TICK_COUNT }, (_, i) => Number((domainMinRounded + i * tickStep).toFixed(2)));
  const yDomain: [number, number] = [domainMinRounded, Number((domainMinRounded + tickStep * (TICK_COUNT - 1)).toFixed(2))];

  return (
    <>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" />
          <XAxis dataKey="year" tick={{ fontSize: 12 }} />
          <YAxis
            tick={{ fontSize: 12 }}
            width={60}
            tickFormatter={(v) => Number(v).toFixed(1)}
            domain={yDomain}
            ticks={yTicks}
            label={{ value: 'per 1,000 residents', angle: -90, position: 'insideLeft', fontSize: 11, fill: '#999' }}
          />
          <Tooltip formatter={(value) => Number(value).toFixed(2)} itemSorter={(item) => -(item.value as number)} />
          <Legend wrapperStyle={{ fontSize: '12px' }} />
          <Line
            type="monotone"
            dataKey={CITY_LABELS.stpaul}
            stroke={CITY_COLORS.stpaul}
            strokeWidth={2}
            dot={false}
            connectNulls
          />
          <Line
            type="monotone"
            dataKey={CITY_LABELS.mpls}
            stroke={CITY_COLORS.mpls}
            strokeWidth={2}
            dot={false}
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>
      {caption && <div style={{ fontSize: '12px', color: '#666', marginTop: '-4px' }}>{caption}</div>}
    </>
  );
}

// Summarizes % change from the first to the last non-null data point per
// city, so the chart answers "did this go up or down" at a glance instead of
// making the reader eyeball two lines.
function describeTrend(chartData: Record<string, number | null>[], metric: string): string | null {
  const noun = METRIC_LABELS[metric]?.toLowerCase() ?? metric;
  const sentences: string[] = [];
  for (const city of ['stpaul', 'mpls'] as const) {
    const label = CITY_LABELS[city];
    const values = chartData
      .map((row) => ({ year: row.year as unknown as number, value: row[label] }))
      .filter((row): row is { year: number; value: number } => row.value != null);
    if (values.length < 2) continue;
    const first = values[0];
    const last = values[values.length - 1];
    if (first.value === 0) continue;
    const pctChange = ((last.value - first.value) / first.value) * 100;
    if (Math.abs(pctChange) < 1) continue;
    sentences.push(
      `${label} ${noun} ${pctChange >= 0 ? 'rose' : 'declined'} ${Math.abs(pctChange).toFixed(0)}% since ${first.year}`
    );
  }
  return sentences.length > 0 ? sentences.join('; ') + '.' : null;
}
