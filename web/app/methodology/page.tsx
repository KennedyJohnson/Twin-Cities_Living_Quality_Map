import Link from 'next/link';

export default function MethodologyPage() {
  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', padding: '32px 20px', lineHeight: 1.6 }}>
      <Link href="/" style={{ fontSize: '13px', color: '#756bb1' }}>
        ← Back to map
      </Link>
      <h1 style={{ fontSize: '24px', fontWeight: 700, margin: '12px 0 24px' }}>
        How We Calculate This
      </h1>

      <p style={{ marginBottom: '20px' }}>
        Every district gets an overall <strong>Health Score</strong> (0–100) built from four
        component indices, each also scored 0–100:
      </p>

      <ul style={{ marginBottom: '24px', paddingLeft: '20px' }}>
        <li><strong>Safety (35%)</strong> — inverse of crime rate per capita</li>
        <li><strong>Opportunity (25%)</strong> — building permit rate per capita and unemployment rate (inverted)</li>
        <li><strong>Quality of Life (20%)</strong> — service requests (inverted), housing production, traffic volume (inverted), and (where available) trails, transit stops, schools, and grocery stores</li>
        <li><strong>Affordability (20%)</strong> — Census median home value, rent, poverty rate, and housing cost burden (all inverted), and median household income</li>
      </ul>

      <h2 style={{ fontSize: '18px', fontWeight: 600, marginTop: '32px', marginBottom: '12px' }}>
        Step 1: Per-capita rates
      </h2>
      <p style={{ marginBottom: '20px' }}>
        Raw counts (crime incidents, permits, service requests, etc.) are converted to a rate per
        1,000 residents, so a small district with fewer incidents isn&apos;t unfairly penalized
        against a large one.
      </p>

      <h2 style={{ fontSize: '18px', fontWeight: 600, marginTop: '32px', marginBottom: '12px' }}>
        Step 2: Normalization
      </h2>
      <p style={{ marginBottom: '20px' }}>
        Each rate is normalized against every other district using a z-score (how many standard
        deviations a district is from the citywide average), then squashed through a logistic
        curve into a 0–100 range. This is deliberately different from simple min-max scaling: with
        min-max, the single most extreme district always lands at exactly 0 or 100, which
        overstates how unusual it really is. The z-score + logistic approach compresses outliers
        asymptotically instead — extreme districts land near, but never exactly at, the floor or
        ceiling.
      </p>

      <h2 style={{ fontSize: '18px', fontWeight: 600, marginTop: '32px', marginBottom: '12px' }}>
        Step 3: Direction
      </h2>
      <p style={{ marginBottom: '20px' }}>
        Some metrics are inverted before blending, because a higher raw number is worse, not
        better — crime rate, service requests, traffic volume, and housing cost are all inverted
        so that a <em>lower</em> rate produces a <em>higher</em> index score.
      </p>

      <h2 style={{ fontSize: '18px', fontWeight: 600, marginTop: '32px', marginBottom: '12px' }}>
        Step 4: Blend into indices, then into one score
      </h2>
      <p style={{ marginBottom: '20px' }}>
        Within a component (e.g. Quality of Life), each metric&apos;s normalized value is combined
        into a single index using a weighted average. The four indices are then combined into the
        overall Health Score using the weights above (35/25/20/20).
      </p>

      <h2 style={{ fontSize: '18px', fontWeight: 600, marginTop: '32px', marginBottom: '12px' }}>
        Data sources
      </h2>
      <ul style={{ marginBottom: '20px', paddingLeft: '20px' }}>
        <li>
          <a href="https://information.stpaul.gov/" target="_blank" rel="noopener noreferrer" style={{ color: '#756bb1' }}>
            City of St. Paul Open Data
          </a>{' '}
          &amp;{' '}
          <a href="https://opendata.minneapolismn.gov/" target="_blank" rel="noopener noreferrer" style={{ color: '#756bb1' }}>
            City of Minneapolis Open Data
          </a>{' '}
          — crime, permits, service requests, housing production
        </li>
        <li>
          <a href="https://www.openstreetmap.org/" target="_blank" rel="noopener noreferrer" style={{ color: '#756bb1' }}>
            OpenStreetMap
          </a>{' '}
          (via the{' '}
          <a href="https://overpass-api.de/" target="_blank" rel="noopener noreferrer" style={{ color: '#756bb1' }}>
            Overpass API
          </a>
          ) — trails/paths, transit stops, schools, grocery stores
        </li>
        <li>
          <a href="https://www.census.gov/programs-surveys/acs" target="_blank" rel="noopener noreferrer" style={{ color: '#756bb1' }}>
            U.S. Census Bureau ACS 5-Year Estimates
          </a>{' '}
          — median home value, gross rent, and household income
        </li>
        <li>
          <a href="https://www.dot.state.mn.us/traffic/data/" target="_blank" rel="noopener noreferrer" style={{ color: '#756bb1' }}>
            MnDOT Traffic Forecasting &amp; Analysis
          </a>{' '}
          — Annual Average Daily Traffic (AADT) road segment volumes
        </li>
      </ul>

      <p style={{ fontSize: '12px', color: '#999', marginTop: '32px' }}>
        St. Paul&apos;s crime data has no geocoded address in the source, only a district — so
        individual crime incidents aren&apos;t plotted as markers on the map (Minneapolis crime
        does include real coordinates and is plotted). St. Paul crime still fully feeds the
        Safety index and district-level Crime Rate metric.
      </p>
    </div>
  );
}
