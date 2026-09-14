'use client';

import { useEffect, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface DistrictSeries {
  median_home_value: (number | null)[];
  median_gross_rent: (number | null)[];
  median_household_income: (number | null)[];
  poverty_rate: (number | null)[];
  homeownership_rate: (number | null)[];
  unemployment_rate_pc: (number | null)[];
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
  homeownership_rate: 'Homeownership Rate',
  unemployment_rate_pc: 'Unemployed Residents per 1,000',
};

const PERCENT_FIELDS = new Set<keyof DistrictSeries>(['poverty_rate', 'homeownership_rate']);

const CITY_COLORS: Record<'stpaul' | 'mpls', string> = {
  stpaul: '#756bb1',
  mpls: '#31a354',
};

const CITY_LABELS: Record<'stpaul' | 'mpls', string> = {
  stpaul: 'St. Paul',
  mpls: 'Minneapolis',
};

function average(values: (number | null)[]): number | null {
  const valid = values.filter((v): v is number => v != null);
  if (valid.length === 0) return null;
  return Math.round(valid.reduce((s, v) => s + v, 0) / valid.length);
}

export default function AffordabilityComparisonChart({ field }: { field: keyof DistrictSeries }) {
  const [chartData, setChartData] = useState<Record<string, number | null>[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    Promise.all(
      (['stpaul', 'mpls'] as const).map((city) =>
        fetch(`/data/affordability_timeseries_${city}.json`).then((r) => (r.ok ? r.json() : Promise.reject()))
      )
    )
      .then(([stpaul, mpls]: AffordabilityTimeSeriesFile[]) => {
        const years = stpaul.years;
        const stpaulDistricts = Object.values(stpaul.districts);
        const mplsDistricts = Object.values(mpls.districts);
        const points = years.map((year, i) => ({
          year,
          [CITY_LABELS.stpaul]: average(stpaulDistricts.map((d) => d[field][i])),
          [CITY_LABELS.mpls]: average(mplsDistricts.map((d) => d[field][i])),
        }));
        setChartData(points);
      })
      .catch(() => setError(true));
  }, [field]);

  if (error) {
    return <div style={{ color: '#999', fontSize: '13px' }}>Data unavailable.</div>;
  }

  if (!chartData) {
    return <div style={{ color: '#999', fontSize: '13px' }}>Loading…</div>;
  }

  const isPercent = PERCENT_FIELDS.has(field);
  const formatValue = (v: number) =>
    isPercent ? `${v}%` : field === 'unemployment_rate_pc' ? `${v}` : `$${Number(v).toLocaleString()}`;

  return (
    <div>
      <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '4px' }}>{FIELD_LABELS[field]}</div>
      <ResponsiveContainer width="100%" height={170}>
        <LineChart data={chartData} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" />
          <XAxis dataKey="year" tick={{ fontSize: 12 }} />
          <YAxis
            tick={{ fontSize: 12 }}
            tickFormatter={(v) =>
              isPercent ? `${v}%` : field === 'unemployment_rate_pc' ? `${v}` : `$${Math.round(v / 1000)}k`
            }
            width={56}
          />
          <Tooltip formatter={(v) => formatValue(Number(v))} itemSorter={(item) => -(item.value as number)} />
          <Legend wrapperStyle={{ fontSize: '12px' }} />
          <Line
            type="monotone"
            dataKey={CITY_LABELS.stpaul}
            stroke={CITY_COLORS.stpaul}
            strokeWidth={2}
            dot
            connectNulls
          />
          <Line
            type="monotone"
            dataKey={CITY_LABELS.mpls}
            stroke={CITY_COLORS.mpls}
            strokeWidth={2}
            dot
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
