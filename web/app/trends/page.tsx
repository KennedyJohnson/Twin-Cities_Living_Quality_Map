'use client';

import Link from 'next/link';
import TimeSeriesComparisonChart from '@/components/TimeSeriesComparisonChart';
import AffordabilityComparisonChart from '@/components/AffordabilityComparisonChart';
import BiggestMoversTable from '@/components/BiggestMoversTable';

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
    <div style={{ maxWidth: '900px', margin: '0 auto', padding: '20px' }}>
      <Link href="/" style={{ fontSize: '13px', color: '#756bb1' }}>
        ← Back to map
      </Link>
      <h1 style={{ fontSize: '20px', fontWeight: 700, margin: '8px 0 4px' }}>
        Trends Over Time
      </h1>
      <p style={{ fontSize: '12px', color: '#666', marginBottom: '20px', lineHeight: 1.4 }}>
        Citywide totals per year, scaled per 1,000 residents (using each city&apos;s current Census
        population) so St. Paul and Minneapolis are comparable despite their different population
        sizes, grouped by the same component score categories used for the Living Quality Score on
        the map. Crime and permit data starts at 2015. Affordability figures (Census ACS) are only
        available for 2018–2022, averaged across districts.
      </p>

      <section style={{ marginBottom: '24px' }}>
        <SectionTitle subtitle="Which districts changed the most, first year to latest, on the metrics with real year-by-year history">
          Biggest Changes Over Time
        </SectionTitle>
        <p style={{ fontSize: '12px', color: '#666', marginBottom: '16px', lineHeight: 1.4 }}>
          This isn&apos;t the full Living Quality Score over time: most of its inputs (schools,
          transit, crash rate, chronic disease, etc.) are single-snapshot data with no historical
          archive to compare against. Only crime, permits, and the Census Economic Profile fields
          below have genuine multi-year history.
        </p>
        <BiggestMoversTable />
      </section>

      <section style={{ marginBottom: '24px' }}>
        <SectionTitle subtitle="Per 1,000 residents, per year">Crime Incidents</SectionTitle>
        <TimeSeriesComparisonChart metric="crime" />
      </section>

      <section style={{ marginBottom: '24px' }}>
        <SectionTitle subtitle="Per 1,000 residents, per year">Building Permits</SectionTitle>
        <TimeSeriesComparisonChart metric="permits" />
      </section>

      <section style={{ marginBottom: '24px' }}>
        <SectionTitle subtitle="Census ACS figures, averaged across districts, compared side by side">
          Economic Profile
        </SectionTitle>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(320px, 100%), 1fr))', gap: '16px' }}>
          <AffordabilityComparisonChart field="median_home_value" />
          <AffordabilityComparisonChart field="median_gross_rent" />
          <AffordabilityComparisonChart field="median_household_income" />
          <AffordabilityComparisonChart field="poverty_rate" />
          <AffordabilityComparisonChart field="homeownership_rate" />
          <AffordabilityComparisonChart field="unemployment_rate_pc" />
        </div>
      </section>
    </div>
  );
}
