'use client';

import Link from 'next/link';
import TimeSeriesChart from '@/components/TimeSeriesChart';
import CityAffordabilityTrend from '@/components/CityAffordabilityTrend';

const CITIES: { city: 'stpaul' | 'mpls'; label: string }[] = [
  { city: 'stpaul', label: 'St. Paul' },
  { city: 'mpls', label: 'Minneapolis' },
];

function SectionTitle({ children, subtitle }: { children: React.ReactNode; subtitle: string }) {
  return (
    <div style={{ marginBottom: '12px' }}>
      <h2 style={{ fontSize: '18px', fontWeight: 700 }}>{children}</h2>
      <p style={{ fontSize: '12px', color: '#999' }}>{subtitle}</p>
    </div>
  );
}

export default function TrendsPage() {
  return (
    <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '32px 20px' }}>
      <Link href="/" style={{ fontSize: '13px', color: '#756bb1' }}>
        ← Back to map
      </Link>
      <h1 style={{ fontSize: '24px', fontWeight: 700, margin: '12px 0 4px' }}>
        Trends Over Time
      </h1>
      <p style={{ fontSize: '13px', color: '#666', marginBottom: '32px', lineHeight: 1.5 }}>
        Citywide totals by year, grouped by the same component score categories used for the
        Health Score on the map. Crime and permit data starts at 2015. Affordability figures
        (Census ACS) are only available for 2018–2022, averaged across districts.
      </p>

      <section style={{ marginBottom: '40px' }}>
        <SectionTitle subtitle="Crime incidents per year">Safety</SectionTitle>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '24px' }}>
          {CITIES.map(({ city, label }) => (
            <div key={city}>
              <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '4px' }}>{label}</h3>
              <TimeSeriesChart city={city} cityLabel={label} metrics={['crime']} />
            </div>
          ))}
        </div>
      </section>

      <section style={{ marginBottom: '40px' }}>
        <SectionTitle subtitle="Building permits per year">Opportunity</SectionTitle>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '24px' }}>
          {CITIES.map(({ city, label }) => (
            <div key={city}>
              <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '4px' }}>{label}</h3>
              <TimeSeriesChart city={city} cityLabel={label} metrics={['permits']} />
            </div>
          ))}
        </div>
      </section>

      <section style={{ marginBottom: '40px' }}>
        <SectionTitle subtitle="Service requests and housing production per year (Housing Production uses the right-hand axis — its counts run far smaller than Service Requests)">
          Quality of Life
        </SectionTitle>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '24px' }}>
          <div>
            <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '4px' }}>St. Paul</h3>
            <TimeSeriesChart city="stpaul" cityLabel="St. Paul" metrics={['requests', 'housing']} />
          </div>
          <div>
            <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '4px' }}>Minneapolis</h3>
            <TimeSeriesChart city="mpls" cityLabel="Minneapolis" metrics={['housing']} />
            <p style={{ fontSize: '11px', color: '#999', marginTop: '4px' }}>
              Minneapolis&apos;s 311 service request dataset only covers 2025, so a multi-year
              Service Requests trend isn&apos;t available for this city.
            </p>
          </div>
        </div>
      </section>

      <section style={{ marginBottom: '40px' }}>
        <SectionTitle subtitle="Census ACS median home value, rent, and household income, averaged across districts">
          Affordability
        </SectionTitle>
        {CITIES.map(({ city, label }) => (
          <div key={city} style={{ marginBottom: '24px' }}>
            <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '8px' }}>{label}</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '16px' }}>
              <CityAffordabilityTrend city={city} cityLabel={label} field="median_home_value" />
              <CityAffordabilityTrend city={city} cityLabel={label} field="median_gross_rent" />
              <CityAffordabilityTrend city={city} cityLabel={label} field="median_household_income" />
              <CityAffordabilityTrend city={city} cityLabel={label} field="poverty_rate" />
              <CityAffordabilityTrend city={city} cityLabel={label} field="housing_cost_burden_rate" />
              <CityAffordabilityTrend city={city} cityLabel={label} field="homeownership_rate" />
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
