'use client';

import { useEffect, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface DistrictSeries {
  median_home_value: (number | null)[];
  median_gross_rent: (number | null)[];
  median_household_income: (number | null)[];
  poverty_rate: (number | null)[];
  housing_cost_burden_rate: (number | null)[];
  homeownership_rate: (number | null)[];
}

interface AffordabilityTimeSeriesFile {
  years: number[];
  districts: Record<string, DistrictSeries>;
}

const FIELD_LABELS: Record<keyof DistrictSeries, string> = {
  median_home_value: 'Median Home Value',
  median_gross_rent: 'Median Gross Rent',
  median_household_income: 'Median Household Income',
  poverty_rate: 'Poverty Rate',
  housing_cost_burden_rate: 'Housing Cost Burden (renters)',
  homeownership_rate: 'Homeownership Rate',
};

const PERCENT_FIELDS = new Set<keyof DistrictSeries>(['poverty_rate', 'housing_cost_burden_rate', 'homeownership_rate']);

interface CityAffordabilityTrendProps {
  city: 'stpaul' | 'mpls';
  cityLabel: string;
  field: keyof DistrictSeries;
}

function average(values: (number | null)[]): number | null {
  const valid = values.filter((v): v is number => v != null);
  if (valid.length === 0) return null;
  return Math.round(valid.reduce((s, v) => s + v, 0) / valid.length);
}

export default function CityAffordabilityTrend({ city, cityLabel, field }: CityAffordabilityTrendProps) {
  const [chartData, setChartData] = useState<{ year: number; value: number | null }[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch(`/data/affordability_timeseries_${city}.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((json: AffordabilityTimeSeriesFile) => {
        const districts = Object.values(json.districts);
        const points = json.years.map((year, i) => ({
          year,
          value: average(districts.map((d) => d[field][i])),
        }));
        setChartData(points);
      })
      .catch(() => setError(true));
  }, [city, field]);

  if (error) {
    return <div style={{ color: '#999', fontSize: '13px' }}>Data unavailable for {cityLabel}.</div>;
  }

  if (!chartData) {
    return <div style={{ color: '#999', fontSize: '13px' }}>Loading…</div>;
  }

  const isPercent = PERCENT_FIELDS.has(field);

  return (
    <div>
      <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '4px' }}>{FIELD_LABELS[field]}</div>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={chartData} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" />
          <XAxis dataKey="year" tick={{ fontSize: 12 }} />
          <YAxis
            tick={{ fontSize: 12 }}
            tickFormatter={(v) => (isPercent ? `${v}%` : `$${Math.round(v / 1000)}k`)}
            width={56}
          />
          <Tooltip formatter={(v) => (isPercent ? `${v}%` : `$${Number(v).toLocaleString()}`)} />
          <Line type="monotone" dataKey="value" stroke="#756bb1" strokeWidth={2} dot connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
