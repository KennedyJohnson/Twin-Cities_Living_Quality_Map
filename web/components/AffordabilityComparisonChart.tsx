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

// A rising value is bad for these (poverty, unemployment); for everything
// else in this chart (income, homeownership, home value, rent) rising is
// good. Matches the good/bad convention in metricLabels.ts's `inverted` flag.
const INVERTED_FIELDS = new Set<keyof DistrictSeries>(['poverty_rate', 'unemployment_rate_pc']);
const GOOD_COLOR = '#2a9d5c';
const BAD_COLOR = '#c0392b';

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
  const captionParts = describeAffordabilityTrend(chartData, INVERTED_FIELDS.has(field));

  const allValues = chartData.flatMap((row) =>
    (['stpaul', 'mpls'] as const).map((c) => row[CITY_LABELS[c]]).filter((v): v is number => v != null)
  );
  const rawMin = allValues.length ? Math.min(...allValues) : 0;
  const rawMax = allValues.length ? Math.max(...allValues) : 1;
  const step = isPercent || field === 'unemployment_rate_pc' ? 1 : 100;
  const padding = Math.max((rawMax - rawMin) * 0.1, step);
  const domainMin = Math.floor((rawMin - padding) / step) * step;
  const domainMax = Math.ceil((rawMax + padding) / step) * step;
  const TICK_COUNT = 5;
  const rawTickStep = (domainMax - domainMin) / (TICK_COUNT - 1);
  const tickStep = Math.max(Math.ceil(rawTickStep / step) * step, step);
  const yTicks = Array.from({ length: TICK_COUNT }, (_, i) => domainMin + i * tickStep);
  const yDomain: [number, number] = [domainMin, domainMin + tickStep * (TICK_COUNT - 1)];

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
              isPercent
                ? `${v}%`
                : field === 'unemployment_rate_pc'
                ? `${v}`
                : `$${Math.round(v / 100) * 100 >= 1000 ? `${(Math.round(v / 100) * 100 / 1000).toFixed(1)}k` : Math.round(v / 100) * 100}`
            }
            width={56}
            domain={yDomain}
            ticks={yTicks}
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
      {captionParts.length > 0 && (
        <div style={{ fontSize: '11px', color: '#666', marginTop: '-4px' }}>
          {captionParts.map((part, i) => (
            <span key={i}>
              {i > 0 && '; '}
              {part.label} {fieldLabelLower(field)}{' '}
              <span style={{ color: part.isGood ? GOOD_COLOR : BAD_COLOR }}>
                {part.pctChange >= 0 ? 'rose' : 'declined'} {Math.abs(part.pctChange).toFixed(0)}%
              </span>{' '}
              since {part.firstYear}
            </span>
          ))}
          .
        </div>
      )}
    </div>
  );
}

function fieldLabelLower(field: keyof DistrictSeries): string {
  return FIELD_LABELS[field].toLowerCase();
}

// Summarizes % change from the first to the last non-null data point per
// city, so the chart answers "did this go up or down" at a glance.
function describeAffordabilityTrend(
  chartData: Record<string, number | null>[],
  inverted: boolean
): { label: string; pctChange: number; firstYear: number; isGood: boolean }[] {
  const parts: { label: string; pctChange: number; firstYear: number; isGood: boolean }[] = [];
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
    const isGood = inverted ? pctChange < 0 : pctChange >= 0;
    parts.push({ label, pctChange, firstYear: first.year, isGood });
  }
  return parts;
}
