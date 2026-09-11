'use client';

import { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend as RechartsLegend, ResponsiveContainer } from 'recharts';
import { loadNeighborhoodData } from '@/lib/loadNeighborhoodData';
import type { Neighborhood } from '@/types/neighborhood';

interface IndexComparisonChartProps {
  district: Neighborhood;
}

function cityForDistrict(districtId: number): 'stpaul' | 'mpls' {
  return districtId >= 100 ? 'mpls' : 'stpaul';
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

export default function IndexComparisonChart({ district }: IndexComparisonChartProps) {
  const [chartData, setChartData] = useState<{ name: string; thisDistrict: number; average: number }[] | null>(null);

  useEffect(() => {
    const city = cityForDistrict(district.district_id);
    const cacheKey = `${city}:${district.district_id}`;

    const buildRows = (averages: Averages) => {
      const rows: { name: string; thisDistrict: number; average: number }[] = [
        { name: 'Health Score', thisDistrict: district.health_score, average: averages.health_score },
      ];
      if (district.indices.safety != null) {
        rows.push({ name: 'Safety', thisDistrict: district.indices.safety, average: averages.safety });
      }
      if (district.indices.opportunity != null) {
        rows.push({ name: 'Opportunity', thisDistrict: district.indices.opportunity, average: averages.opportunity });
      }
      if (district.indices.amenities != null) {
        rows.push({ name: 'Amenities & Services', thisDistrict: district.indices.amenities, average: averages.amenities });
      }
      if (district.indices.transportation != null) {
        rows.push({ name: 'Transportation', thisDistrict: district.indices.transportation, average: averages.transportation });
      }
      if (district.indices.affordability != null) {
        rows.push({ name: 'Affordability', thisDistrict: district.indices.affordability, average: averages.affordability });
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
        {district.is_radius ? 'This Location vs. District Average' : 'This District vs. Other Districts'}
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
          <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10 }} />
          <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={90} />
          <Tooltip contentStyle={{ fontSize: '11px' }} />
          <RechartsLegend wrapperStyle={{ fontSize: '10px' }} />
          <Bar dataKey="thisDistrict" name={district.is_radius ? 'This location' : 'This district'} fill="#756bb1" radius={[0, 3, 3, 0]} />
          <Bar dataKey="average" name="Average of others" fill="#ccc" radius={[0, 3, 3, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
