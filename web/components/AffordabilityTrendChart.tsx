'use client';

import { useEffect, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend as RechartsLegend, ResponsiveContainer } from 'recharts';

interface DistrictSeries {
  median_home_value: (number | null)[];
  median_gross_rent: (number | null)[];
  median_household_income: (number | null)[];
  poverty_rate: (number | null)[];
  housing_cost_burden_rate: (number | null)[];
  homeownership_rate: (number | null)[];
}

const PERCENT_FIELDS = new Set(['poverty_rate', 'housing_cost_burden_rate', 'homeownership_rate']);

interface AffordabilityTimeSeriesFile {
  years: number[];
  districts: Record<string, DistrictSeries>;
}

interface AffordabilityTrendChartProps {
  districtId: number;
  field: keyof DistrictSeries;
  label: string;
}

function cityForDistrict(districtId: number): 'stpaul' | 'mpls' {
  return districtId >= 100 ? 'mpls' : 'stpaul';
}

function average(values: (number | null)[]): number | null {
  const valid = values.filter((v): v is number => v != null);
  if (valid.length === 0) return null;
  return Math.round(valid.reduce((s, v) => s + v, 0) / valid.length);
}

export default function AffordabilityTrendChart({ districtId, field, label }: AffordabilityTrendChartProps) {
  const [chartData, setChartData] = useState<{ year: number; value: number | null; average: number | null }[] | null>(null);
  const [error, setError] = useState(false);
  const isPercent = PERCENT_FIELDS.has(field as string);

  useEffect(() => {
    setChartData(null);
    setError(false);
    const city = cityForDistrict(districtId);
    fetch(`/data/affordability_timeseries_${city}.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((json: AffordabilityTimeSeriesFile) => {
        const series = json.districts[String(districtId)];
        if (!series) {
          setError(true);
          return;
        }
        const allDistricts = Object.values(json.districts);
        setChartData(
          json.years.map((year, i) => ({
            year,
            value: series[field][i],
            average: average(allDistricts.map((d) => d[field][i])),
          }))
        );
      })
      .catch(() => setError(true));
  }, [districtId, field]);

  if (error) {
    return <div style={{ fontSize: '11px', color: '#999', marginTop: '4px' }}>No trend data available.</div>;
  }

  if (!chartData) {
    return <div style={{ fontSize: '11px', color: '#999', marginTop: '4px' }}>Loading trend…</div>;
  }

  const formatValue = (v: number) => (isPercent ? `${v}%` : `$${Number(v).toLocaleString()}`);

  return (
    <div style={{ marginTop: '6px', marginBottom: '4px' }}>
      <div style={{ fontSize: '11px', color: '#666', marginBottom: '2px' }}>{label} by year (vs. citywide average)</div>
      <ResponsiveContainer width="100%" height={120}>
        <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <XAxis dataKey="year" tick={{ fontSize: 10 }} />
          <YAxis
            tick={{ fontSize: 10 }}
            width={48}
            tickFormatter={(v) => (isPercent ? `${v}%` : `$${Math.round(v / 1000)}k`)}
          />
          <Tooltip contentStyle={{ fontSize: '11px' }} formatter={(v) => formatValue(Number(v))} />
          <RechartsLegend wrapperStyle={{ fontSize: '10px' }} />
          <Line type="monotone" dataKey="value" name="This district" stroke="#756bb1" strokeWidth={2} dot={false} connectNulls />
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
