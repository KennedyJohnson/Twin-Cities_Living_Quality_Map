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

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" />
        <XAxis dataKey="year" tick={{ fontSize: 12 }} />
        <YAxis
          tick={{ fontSize: 12 }}
          width={60}
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
  );
}
