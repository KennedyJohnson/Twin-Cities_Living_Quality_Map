import Link from 'next/link';

function TechRow({ name, href, use }: { name: string; href?: string; use: string }) {
  return (
    <li style={{ marginBottom: '8px' }}>
      <strong>
        {href ? (
          <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: '#756bb1' }}>
            {name}
          </a>
        ) : (
          name
        )}
      </strong>{' '}
      — {use}
    </li>
  );
}

export default function AboutPage() {
  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', padding: '32px 20px', lineHeight: 1.6 }}>
      <Link href="/" style={{ fontSize: '13px', color: '#756bb1' }}>
        ← Back to map
      </Link>
      <h1 style={{ fontSize: '24px', fontWeight: 700, margin: '12px 0 24px' }}>
        About This Project
      </h1>

      <p style={{ marginBottom: '20px' }}>
        The Twin Cities Living Quality Map is a data pipeline and interactive dashboard built to
        explore public safety, development, amenities and services, and housing affordability across St.
        Paul and Minneapolis districts — combining open government data, OpenStreetMap, Census, and
        MnDOT/CDC figures into a single comparable Living Quality Score per district. See below for the
        scoring methodology, tech stack, and data sources, and{' '}
        <Link href="/trends" style={{ color: '#756bb1' }}>Trends</Link> for the underlying data over
        time.
      </p>

      <h2 style={{ fontSize: '18px', fontWeight: 600, marginTop: '32px', marginBottom: '12px' }}>
        Author
      </h2>
      <p style={{ marginBottom: '20px' }}>
        Built by Kennedy Johnson. More projects at{' '}
        <a href="https://kennedyjohnson.github.io/" target="_blank" rel="noopener noreferrer" style={{ color: '#756bb1' }}>
          kennedyjohnson.github.io
        </a>.
      </p>

      <h2 style={{ fontSize: '18px', fontWeight: 600, marginTop: '32px', marginBottom: '12px' }}>
        How We Calculate This
      </h2>

      <p style={{ marginBottom: '20px' }}>
        Every district gets an overall <strong>Health Score</strong> (0–100) built from five
        component indices, each also scored 0–100:
      </p>

      <ul style={{ marginBottom: '24px', paddingLeft: '20px' }}>
        <li><strong>Safety (35%)</strong> — crime rate, pedestrian/cyclist crash rate, natural hazard risk, and chronic disease burden (obesity/diabetes prevalence), all inverted</li>
        <li><strong>Opportunity (25%)</strong> — building permit rate per capita and unemployment rate (inverted)</li>
        <li><strong>Amenities &amp; Services (10%)</strong> — service requests (inverted), plus housing production, schools, grocery stores, restaurants/bars, and healthcare access</li>
        <li><strong>Transportation (10%)</strong> — trail/path length and transit stop rate, minus traffic volume (inverted); blended 70/30 with a Zillow-style Walk/Bike Score (distance-decay proximity to daily-need amenities plus street-intersection density)</li>
        <li><strong>Affordability (20%)</strong> — Census median home value, rent, poverty rate, and housing cost burden (all inverted), plus median household income and homeownership rate</li>
      </ul>

      <h3 style={{ fontSize: '16px', fontWeight: 600, marginTop: '24px', marginBottom: '12px' }}>
        Step 1: Per-capita rates
      </h3>
      <p style={{ marginBottom: '20px' }}>
        Raw counts (crime incidents, permits, service requests, etc.) are converted to a rate per
        1,000 residents, so a small district with fewer incidents isn&apos;t unfairly penalized
        against a large one.
      </p>

      <h3 style={{ fontSize: '16px', fontWeight: 600, marginTop: '24px', marginBottom: '12px' }}>
        Step 2: Normalization
      </h3>
      <p style={{ marginBottom: '20px' }}>
        Each rate is normalized against every other district using a z-score (how many standard
        deviations a district is from the citywide average), then squashed through a logistic
        curve into a 0–100 range. This is deliberately different from simple min-max scaling: with
        min-max, the single most extreme district always lands at exactly 0 or 100, which
        overstates how unusual it really is. The z-score + logistic approach compresses outliers
        asymptotically instead — extreme districts land near, but never exactly at, the floor or
        ceiling.
      </p>

      <h3 style={{ fontSize: '16px', fontWeight: 600, marginTop: '24px', marginBottom: '12px' }}>
        Step 3: Direction
      </h3>
      <p style={{ marginBottom: '20px' }}>
        Some metrics are inverted before blending, because a higher raw number is worse, not
        better — crime rate, service requests, traffic volume, and housing cost are all inverted
        so that a <em>lower</em> rate produces a <em>higher</em> index score.
      </p>

      <h3 style={{ fontSize: '16px', fontWeight: 600, marginTop: '24px', marginBottom: '12px' }}>
        Step 4: Blend into indices, then into one score
      </h3>
      <p style={{ marginBottom: '20px' }}>
        Within a component (e.g. Amenities &amp; Services), each metric&apos;s normalized value is combined
        into a single index using a weighted average. The four indices are then combined into the
        overall Health Score using the weights above (35/25/20/20).
      </p>

      <h2 style={{ fontSize: '18px', fontWeight: 600, marginTop: '32px', marginBottom: '12px' }}>
        Built With
      </h2>
      <ul style={{ paddingLeft: '20px', marginBottom: '24px' }}>
        <TechRow name="Next.js" use="the frontend app and page routing" />
        <TechRow name="React" use="the UI components" />
        <TechRow name="TypeScript" use="type-checked frontend code" />
        <TechRow name="Leaflet" use="the interactive map, district boundaries, and data-point markers" />
        <TechRow name="react-leaflet" use="React bindings for Leaflet" />
        <TechRow name="Recharts" use="the trend and affordability line charts" />
        <TechRow name="Python" use="the data pipeline language" />
        <TechRow name="pandas" use="tabular data cleaning and aggregation" />
        <TechRow name="Shapely" use="geospatial joins (points/lines to district polygons)" />
        <TechRow name="NumPy" use="the score normalization math" />
        <TechRow name="pytest" use="unit tests for the scoring math" />
        <TechRow name="Playwright" use="end-to-end tests of the map UI" />
        <TechRow name="GitHub Actions" use="scheduled data refreshes and CI on every pull request" />
        <TechRow name="Vercel" use="hosting, deployment, and analytics" />
        <TechRow name="Claude Code" use="AI-assisted development of the pipeline and frontend" />
      </ul>

      <h2 style={{ fontSize: '18px', fontWeight: 600, marginTop: '32px', marginBottom: '12px' }}>
        Data Sources
      </h2>
      <p style={{ marginBottom: '20px' }}>
        Data is refreshed automatically every Monday via a scheduled GitHub Actions pipeline run.
      </p>
      {/* Keep in sync with every external API the pipeline fetches from (see pipeline/cleaners, pipeline/core) */}
      <ul style={{ paddingLeft: '20px', marginBottom: '24px' }}>
        <TechRow name="City of St. Paul Open Data" href="https://information.stpaul.gov/" use="crime, permits, service requests, housing production" />
        <TechRow name="City of Minneapolis Open Data" href="https://opendata.minneapolismn.gov/" use="crime, permits, service requests, housing production" />
        <TechRow name="OpenStreetMap" href="https://www.openstreetmap.org/" use="trails, transit stops, schools, grocery stores, restaurants/bars, healthcare facilities, street network (Walk/Bike Score)" />
        <TechRow name="Overpass API" href="https://overpass-api.de/" use="queries the OpenStreetMap data above" />
        <TechRow name="U.S. Census Bureau ACS 5-Year Estimates" href="https://www.census.gov/programs-surveys/acs" use="median home value, gross rent, household income, poverty rate, housing cost burden, homeownership rate, unemployment rate" />
        <TechRow name="MnDOT Traffic Forecasting & Analysis" href="https://www.dot.state.mn.us/traffic/data/" use="Annual Average Daily Traffic (AADT) volumes and pedestrian/cyclist crash locations" />
        <TechRow name="CDC PLACES" href="https://www.cdc.gov/places/" use="obesity and diabetes prevalence by census tract" />
        <TechRow name="FEMA National Risk Index" href="https://hazards.fema.gov/nri/" use="natural hazard risk score by census tract" />
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
