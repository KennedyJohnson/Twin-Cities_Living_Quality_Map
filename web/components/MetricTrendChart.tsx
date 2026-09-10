'use client';

import { useEffect, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend as RechartsLegend, ResponsiveContainer } from 'recharts';

interface DistrictSeries {
  years: number[];
  [trendKey: string]: number[] | number;
}

interface TimeSeriesFile {
  citywide: DistrictSeries;
  districts: Record<string, DistrictSeries>;
}

interface MetricTrendChartProps {
  districtId: number;
  trendKey: string;
  label: string;
}

const MIN_YEAR = 2015;
const CURRENT_YEAR = new Date().getFullYear();

function cityForDistrict(districtId: number): 'stpaul' | 'mpls' {
  return districtId >= 100 ? 'mpls' : 'stpaul';
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 10) / 10;
}

export default function MetricTrendChart({ districtId, trendKey, label }: MetricTrendChartProps) {
  const [chartData, setChartData] = useState<{ year: number; value: number; average: number | null }[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    setChartData(null);
    setError(false);
    const city = cityForDistrict(districtId);
    fetch(`/data/timeseries_${city}.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((json: TimeSeriesFile) => {
        const series = json.districts[String(districtId)];
        if (!series || !Array.isArray(series[trendKey])) {
          setError(true);
          return;
        }
        const values = series[trendKey] as number[];
        const allDistricts = Object.values(json.districts);
        const points = series.years
          .map((year, i) => ({
            year,
            value: values[i],
            average: average(allDistricts.map((d) => (d[trendKey] as number[])[i])),
          }))
          .filter((p) => p.year >= MIN_YEAR && p.year < CURRENT_YEAR);
        setChartData(points);
      })
      .catch(() => setError(true));
  }, [districtId, trendKey]);

  if (error) {
    return <div style={{ fontSize: '11px', color: '#999', marginTop: '4px' }}>No trend data available.</div>;
  }

  if (!chartData) {
    return <div style={{ fontSize: '11px', color: '#999', marginTop: '4px' }}>Loading trend…</div>;
  }

  return (
    <div style={{ marginTop: '6px', marginBottom: '4px' }}>
      <div style={{ fontSize: '11px', color: '#666', marginBottom: '2px' }}>{label} by year (vs. citywide average)</div>
      <ResponsiveContainer width="100%" height={120}>
        <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <XAxis dataKey="year" tick={{ fontSize: 10 }} />
          <YAxis tick={{ fontSize: 10 }} width={44} />
          <Tooltip contentStyle={{ fontSize: '11px' }} />
          <RechartsLegend wrapperStyle={{ fontSize: '10px' }} />
          <Line type="monotone" dataKey="value" name="This district" stroke="#756bb1" strokeWidth={2} dot={false} />
          <Line
            type="monotone"
            dataKey="average"
            name="Citywide average"
            stroke="#999"
            strokeWidth={1.5}
            strokeDasharray="4 3"
            dot={false}
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
