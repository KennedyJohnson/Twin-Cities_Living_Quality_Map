'use client';

import { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend as RechartsLegend, ResponsiveContainer } from 'recharts';
import { loadNeighborhoodData } from '@/lib/loadNeighborhoodData';
import type { Neighborhood } from '@/types/neighborhood';

type IndexKey = 'safety' | 'opportunity' | 'amenities' | 'transportation' | 'affordability';

interface IndexComparisonChartProps {
  district: Neighborhood;
  onSelectIndex?: (key: IndexKey) => void;
}

// 'zip' pools all 43 metro ZIPs into one normalization (see
// compute_health_scores_zip), so a ZIP selection compares against every
// other ZIP rather than one city's districts. ZIP codes are 5-digit numbers
// which also satisfy the >= 100 check a Minneapolis district id uses, so
// is_zip (stamped in loadNeighborhoodData.ts) has to be checked first.
function cityForDistrict(district: Neighborhood): 'stpaul' | 'mpls' | 'zip' {
  if (district.is_zip) return 'zip';
  return district.district_id >= 100 ? 'mpls' : 'stpaul';
}

type Averages = {
  health_score: number;
  safety: number;
  opportunity: number;
  amenities: number;
  transportation: number;
  affordability: number;
};

// "Others average" only depends on the district, not the clicked point, so cache it per district
// to avoid recomputing over the full neighborhood list on every click.
const averagesCache: Record<string, Averages> = {};

export default function IndexComparisonChart({ district, onSelectIndex }: IndexComparisonChartProps) {
  const [chartData, setChartData] = useState<
    { name: string; key: IndexKey | null; thisDistrict: number; average: number }[] | null
  >(null);

  useEffect(() => {
    const city = cityForDistrict(district);
    const cacheKey = `${city}:${district.district_id}`;

    const buildRows = (averages: Averages) => {
      const rows: { name: string; key: IndexKey | null; thisDistrict: number; average: number }[] = [
        { name: 'Living Quality Score', key: null, thisDistrict: district.health_score, average: averages.health_score },
      ];
      if (district.indices.safety != null) {
        rows.push({ name: 'Safety', key: 'safety', thisDistrict: district.indices.safety, average: averages.safety });
      }
      if (district.indices.opportunity != null) {
        rows.push({ name: 'Opportunity', key: 'opportunity', thisDistrict: district.indices.opportunity, average: averages.opportunity });
      }
      if (district.indices.amenities != null) {
        rows.push({ name: 'Amenities & Services', key: 'amenities', thisDistrict: district.indices.amenities, average: averages.amenities });
      }
      if (district.indices.transportation != null) {
        rows.push({ name: 'Transportation', key: 'transportation', thisDistrict: district.indices.transportation, average: averages.transportation });
      }
      if (district.indices.affordability != null) {
        rows.push({ name: 'Economic Profile', key: 'affordability', thisDistrict: district.indices.affordability, average: averages.affordability });
      }
      setChartData(rows.map((r) => ({ ...r, thisDistrict: Math.round(r.thisDistrict * 10) / 10, average: Math.round(r.average * 10) / 10 })));
    };

    if (averagesCache[cacheKey]) {
      buildRows(averagesCache[cacheKey]);
      return;
    }

    loadNeighborhoodData(city)
      .then((data) => {
        const others = data.neighborhoods.filter((n) => n.district_id !== district.district_id);
        const avg = (values: number[]) => (values.length === 0 ? 0 : values.reduce((s, v) => s + v, 0) / values.length);

        const averages: Averages = {
          health_score: avg(others.map((n) => n.health_score)),
          safety: avg(others.map((n) => n.indices.safety).filter((v): v is number => v != null)),
          opportunity: avg(others.map((n) => n.indices.opportunity).filter((v): v is number => v != null)),
          amenities: avg(others.map((n) => n.indices.amenities).filter((v): v is number => v != null)),
          transportation: avg(others.map((n) => n.indices.transportation).filter((v): v is number => v != null)),
          affordability: avg(others.map((n) => n.indices.affordability).filter((v): v is number => v != null)),
        };
        averagesCache[cacheKey] = averages;
        buildRows(averages);
      })
      .catch(() => setChartData(null));
  }, [district]);

  if (!chartData) {
    return null;
  }

  return (
    <div style={{ marginBottom: '20px' }}>
      <div style={{ fontSize: '13px', fontWeight: '600', marginBottom: '10px', color: '#666' }}>
        {district.is_radius
          ? 'This Location vs. District Average'
          : district.is_zip
          ? 'This ZIP vs. Other ZIPs'
          : 'This District vs. Other Districts'}
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: 4, right: 16, left: 8, bottom: 4 }}
          barCategoryGap="30%"
          barGap={2}
        >
          <XAxis
            type="number"
            domain={([dataMin, dataMax]: [number, number]) => {
              const padding = Math.max((dataMax - dataMin) * 0.1, 2);
              return [Math.max(0, Math.floor(dataMin - padding)), Math.min(100, Math.ceil(dataMax + padding))];
            }}
            tick={{ fontSize: 10 }}
          />
          <YAxis
            type="category"
            dataKey="name"
            tick={{ fontSize: 11 }}
            width={90}
            onClick={(tick: any) => {
              const row = chartData?.find((r) => r.name === tick?.value);
              if (row?.key && onSelectIndex) onSelectIndex(row.key);
            }}
            style={onSelectIndex ? { cursor: 'pointer' } : undefined}
          />
          <Tooltip contentStyle={{ fontSize: '11px' }} />
          <RechartsLegend wrapperStyle={{ fontSize: '10px' }} />
          <Bar
            dataKey="thisDistrict"
            name={district.is_radius ? 'This location' : district.is_zip ? 'This ZIP' : 'This district'}
            fill="#756bb1"
            radius={[0, 3, 3, 0]}
            isAnimationActive={false}
            onClick={(data: any) => {
              if (data?.key && onSelectIndex) onSelectIndex(data.key);
            }}
            style={onSelectIndex ? { cursor: 'pointer' } : undefined}
          />
          <Bar
            dataKey="average"
            name="Average of others"
            fill="#ccc"
            radius={[0, 3, 3, 0]}
            isAnimationActive={false}
            onClick={(data: any) => {
              if (data?.key && onSelectIndex) onSelectIndex(data.key);
            }}
            style={onSelectIndex ? { cursor: 'pointer' } : undefined}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
