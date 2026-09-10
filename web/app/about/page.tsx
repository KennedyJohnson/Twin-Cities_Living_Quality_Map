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
        explore public safety, development, quality of life, and housing affordability across St.
        Paul and Minneapolis districts — combining open government data, OpenStreetMap, Census, and
        MnDOT/CDC figures into a single comparable Health Score per district.
        See <Link href="/methodology" style={{ color: '#756bb1' }}>How we calculate this</Link> for
        the scoring methodology and <Link href="/trends" style={{ color: '#756bb1' }}>Trends</Link>{' '}
        for the underlying data over time.
      </p>

      <h2 style={{ fontSize: '18px', fontWeight: 600, marginTop: '32px', marginBottom: '12px' }}>
        Built With
      </h2>
      <ul style={{ paddingLeft: '20px', marginBottom: '24px' }}>
        <TechRow name="Next.js" href="https://nextjs.org/" use="the frontend app and page routing" />
        <TechRow name="React" href="https://react.dev/" use="the UI components" />
        <TechRow name="TypeScript" href="https://www.typescriptlang.org/" use="type-checked frontend code" />
        <TechRow name="Leaflet" href="https://leafletjs.com/" use="the interactive map, district boundaries, and data-point markers" />
        <TechRow name="react-leaflet" href="https://react-leaflet.js.org/" use="React bindings for Leaflet" />
        <TechRow name="Recharts" href="https://recharts.org/" use="the trend and affordability line charts" />
        <TechRow name="Python" href="https://www.python.org/" use="the data pipeline language" />
        <TechRow name="pandas" href="https://pandas.pydata.org/" use="tabular data cleaning and aggregation" />
        <TechRow name="Shapely" href="https://shapely.readthedocs.io/" use="geospatial joins (points/lines to district polygons)" />
        <TechRow name="NumPy" href="https://numpy.org/" use="the score normalization math" />
        <TechRow name="pytest" href="https://pytest.org/" use="unit tests for the scoring math" />
        <TechRow name="Playwright" href="https://playwright.dev/" use="end-to-end tests of the map UI" />
        <TechRow name="GitHub Actions" href="https://github.com/features/actions" use="scheduled data refreshes and CI on every pull request" />
        <TechRow name="Vercel" href="https://vercel.com/" use="hosting, deployment, and analytics" />
      </ul>

      <h2 style={{ fontSize: '18px', fontWeight: 600, marginTop: '32px', marginBottom: '12px' }}>
        Data Sources
      </h2>
      <ul style={{ paddingLeft: '20px', marginBottom: '24px' }}>
        <TechRow name="City of St. Paul Open Data" href="https://information.stpaul.gov/" use="crime, permits, service requests, housing production" />
        <TechRow name="City of Minneapolis Open Data" href="https://opendata.minneapolismn.gov/" use="crime, permits, service requests, housing production" />
        <TechRow name="OpenStreetMap" href="https://www.openstreetmap.org/" use="trails, transit stops, schools, grocery stores" />
        <TechRow name="Overpass API" href="https://overpass-api.de/" use="queries the OpenStreetMap data above" />
        <TechRow name="U.S. Census Bureau ACS 5-Year Estimates" href="https://www.census.gov/programs-surveys/acs" use="median home value, gross rent, and household income" />
        <TechRow name="MnDOT Traffic Forecasting & Analysis" href="https://www.dot.state.mn.us/traffic/data/" use="Annual Average Daily Traffic (AADT) road segment volumes" />
      </ul>

      <h2 style={{ fontSize: '18px', fontWeight: 600, marginTop: '32px', marginBottom: '12px' }}>
        Author
      </h2>
      <p>
        Built by Kennedy Johnson. More projects at{' '}
        <a href="https://kennedyjohnson.github.io/" target="_blank" rel="noopener noreferrer" style={{ color: '#756bb1' }}>
          kennedyjohnson.github.io
        </a>.
      </p>
    </div>
  );
}
