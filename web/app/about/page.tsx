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
      </strong>{': '}
      {use}
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
        Paul and Minneapolis districts, combining open government data, OpenStreetMap, Census, and
        MnDOT/CDC figures into a single comparable Living Quality Score per district. See below for the
        scoring methodology, tech stack, and data sources, and{' '}
        <Link href="/trends" style={{ color: '#756bb1' }}>Trends</Link> for the underlying data over
        time, and{' '}
        <Link href="/home-value-model" style={{ color: '#756bb1' }}>the home value prediction write-up</Link>{' '}
        for a model-comparison analysis (Lasso vs. gradient boosting) built on the same pipeline.
      </p>

      <p style={{ marginBottom: '20px', fontSize: '14px', color: '#666', fontStyle: 'italic' }}>
        The Living Quality Score is a comparative index, not an objective measure of quality of
        life: it reflects a specific choice of metrics, geography, normalization, and weighting,
        and is only as complete as the public data available for each city. Use it to compare
        districts, ZIP codes, or buildings against each other, not as a verdict on any one of them.
      </p>

      <h2 style={{ fontSize: '18px', fontWeight: 600, marginTop: '32px', marginBottom: '12px' }}>
        Why Just St. Paul and Minneapolis?
      </h2>
      <p style={{ marginBottom: '20px' }}>
        Mainly because St. Paul and Minneapolis publish genuinely comparable free, open data:
        matching crime/permit feeds, the same Census geography, similar OSM/CDC/MnDOT coverage.
        Adding a third city means finding one whose open data holds up to that same standard, so
        every district stays on the same 0–100 scale.
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
        Data Sources
      </h2>
      <p style={{ marginBottom: '20px' }}>
        Data is refreshed automatically every Monday via a scheduled GitHub Actions pipeline run.
      </p>
      {/* Keep in sync with every external API the pipeline fetches from (see pipeline/cleaners, pipeline/core) */}
      <ul style={{ paddingLeft: '20px', marginBottom: '24px' }}>
        <TechRow name="City of St. Paul Open Data" href="https://information.stpaul.gov/" use="crime, permits" />
        <TechRow name="City of Minneapolis Open Data" href="https://opendata.minneapolismn.gov/" use="crime, permits" />
        <TechRow name="OpenStreetMap" href="https://www.openstreetmap.org/" use="trails, transit stops, schools, grocery stores, restaurants/bars, healthcare facilities, entertainment venues, apartment buildings, street network (Walk/Bike Score), and the named-place search index" />
        <TechRow name="Geofabrik" href="https://download.geofabrik.de/" use="a monthly-refreshed Minnesota OSM data extract, queried locally instead of the public Overpass API: faster and immune to that API's rate limits/outages" />
        <TechRow name="Nominatim" href="https://nominatim.org/" use="address search-bar geocoding and reverse-geocoding a clicked map point to a street address" />
        <TechRow name="U.S. Census Bureau ACS 5-Year Estimates" href="https://www.census.gov/programs-surveys/acs" use="median home value, gross rent, household income, poverty rate, housing cost burden, homeownership rate, unemployment rate, broadband/internet access" />
        <TechRow name="Zillow Research" href="https://www.zillow.com/research/data/" use="for-sale home listing inventory by ZIP, used as a housing-market tightness signal" />
        <TechRow name="MnDOT Traffic Forecasting & Analysis" href="https://www.dot.state.mn.us/traffic/data/" use="Annual Average Daily Traffic (AADT) volumes and pedestrian/cyclist crash locations" />
        <TechRow name="CDC PLACES" href="https://www.cdc.gov/places/" use="obesity and diabetes prevalence by census tract" />
        <TechRow name="FEMA National Risk Index" href="https://hazards.fema.gov/nri/" use="natural hazard risk score by census tract" />
      </ul>
      <p style={{ fontSize: '12px', color: '#999', marginBottom: '24px' }}>
        St. Paul&apos;s crime data has no geocoded address in the source, only a district, so
        individual crime incidents aren&apos;t plotted as markers on the map (Minneapolis crime
        does include real coordinates and is plotted). St. Paul crime still fully feeds the
        Safety index and district-level Crime Rate metric.
      </p>

      <h2 style={{ fontSize: '18px', fontWeight: 600, marginTop: '32px', marginBottom: '12px' }}>
        How We Calculate the Overall Score and Each Component
      </h2>

      <p style={{ marginBottom: '20px' }}>
        Every district gets an overall <strong>Living Quality Score</strong> (0–100) built from five
        component indices, each also scored 0–100:
      </p>

      <ul style={{ marginBottom: '24px', paddingLeft: '20px' }}>
        <li><strong>Safety &amp; Health (20%)</strong>: crime rate, pedestrian/cyclist crash rate, natural hazard risk, and chronic disease burden (obesity/diabetes prevalence), all inverted</li>
        <li><strong>Opportunity (20%)</strong>: building permit rate per capita, unemployment rate (inverted), and Zillow for-sale home-listing tightness (fewer listings relative to population reads as a tighter, more in-demand market)</li>
        <li><strong>Amenities &amp; Services (20%)</strong>: schools, grocery stores, restaurants/bars, healthcare access, and entertainment venues (movie theaters, performing-arts venues, museums/galleries, nightlife, bowling/arcades), blended 85/15 with a Census broadband/internet-access rate</li>
        <li><strong>Transportation (20%)</strong>: trail/path length and transit stop rate, minus traffic volume (inverted); blended 70/30 with a Zillow-style Walk/Bike Score (distance-decay proximity to daily-need amenities plus street-intersection density)</li>
        <li><strong>Economic Profile (20%)</strong>: Census median home value, rent, poverty rate, and housing cost burden (all inverted), plus median household income and homeownership rate</li>
      </ul>

      <p style={{ marginBottom: '20px' }}>
        All 28 districts across both cities (17 St. Paul District Councils + 11 Minneapolis
        Communities) are normalized together in one pool, not city-by-city, so a &quot;72&quot; means
        the same thing in either city. Crime and permit counts are restricted to a shared trailing
        recent-years window before becoming rates, so the two cities&apos; differing data-history
        lengths (e.g. one dataset back to 2014, another only to 2019) don&apos;t skew which city
        looks safer or more active than it really is.
      </p>

      <h3 style={{ fontSize: '16px', fontWeight: 600, marginTop: '24px', marginBottom: '12px' }}>
        How a District Score Is Built
      </h3>
      <p style={{ marginBottom: '20px' }}>
        Raw counts (crime incidents, permits, etc.) first become a rate per 1,000 residents, so a
        small district isn&apos;t unfairly penalized against a large one. Each rate is then
        normalized against every other district with a z-score, squashed through a logistic curve
        into 0–100, deliberately not simple min-max scaling, which would force the single most
        extreme district to exactly 0 or 100 and overstate how unusual it really is; z-score +
        logistic compresses outliers asymptotically, landing near but never exactly at the floor
        or ceiling. Metrics where a higher raw number is worse (crime rate, traffic volume,
        housing cost) are inverted first, so a lower rate produces a higher score.
      </p>
      <p style={{ marginBottom: '20px' }}>
        Within a component, each metric&apos;s normalized value is weight-averaged into that
        component&apos;s index, and the five indices are then blended into the overall Living
        Quality Score using the equal 20/20/20/20/20 weights above, chosen deliberately to avoid
        imposing a subjective preference for any one dimension of quality of life. A
        district-by-district breakdown of all five is always shown alongside the overall score, so
        you can weigh them differently yourself.
      </p>

      <h3 style={{ fontSize: '16px', fontWeight: 600, marginTop: '24px', marginBottom: '12px' }}>
        1-Mile Radius Scores
      </h3>
      <p style={{ marginBottom: '20px' }}>
        Clicking anywhere on the map or searching an address scores that point&apos;s 1-mile
        radius instead of the enclosing district, comparing it against a dense grid of thousands
        of other 1-mile circles sampled across the same city, not whole-district averages, which
        are diluted by sparse edges and parks a small circle would never actually cover. Each
        source is normalized independently before blending, the same z-score treatment district
        scores get. Safety blends the same four signals as the district-level index (crime,
        pedestrian/cyclist crashes, tract-level chronic disease burden, natural hazard risk); the
        one exclusion is the Walk/Bike Score&apos;s distance decay and any metric only available at
        the district level (its weight redistributed among the rest). A clicked/searched point
        gets its name from a local index of named OpenStreetMap places built at data-refresh time
        rather than a live lookup on every click, falling back to Nominatim only for addresses not
        already in that index.
      </p>

      <h3 style={{ fontSize: '16px', fontWeight: 600, marginTop: '24px', marginBottom: '12px' }}>
        ZIP Code Scores
      </h3>
      <p style={{ marginBottom: '20px' }}>
        The map&apos;s &quot;Map view: District / ZIP Code&quot; toggle scores every ZIP code the
        same way, but normalized in its own separate pool: ZIP vs. ZIP, never against districts
        or split per city, so a ZIP&apos;s score/grade is only meaningful relative to other ZIPs,
        the same way a district score only means something relative to other districts; the two
        pools aren&apos;t on a directly comparable 0–100 scale. Only ZIPs with at least 98% of
        their area inside St. Paul or Minneapolis&apos;s combined boundaries are included (27 of
        the ~49 ZCTAs touching the metro), since a ZIP that only clips a corner of a district would
        divide a real population by an artificially small incident count from a source that
        doesn&apos;t cover most of that ZIP&apos;s actual population: a large-majority-area test
        rather than exact containment, since real boundaries rarely align to the pixel.
      </p>
      <p style={{ marginBottom: '20px' }}>
        Every metric that feeds the district score is recomputed at ZIP granularity from the same
        underlying sources (including household affordability figures and the Walk/Bike Score),
        rather than being interpolated or copied down from the enclosing district. The one gap:
        multi-year trend charts (crime, permits, affordability over time) aren&apos;t computed at
        ZIP granularity, so a ZIP&apos;s detail panel shows its current metrics and score but no
        historical trend line.
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
        <TechRow name="pyosmium" use="reads the local Geofabrik OSM extract directly, replacing live Overpass API calls" />
        <TechRow name="NumPy" use="the score normalization math" />
        <TechRow name="pytest" use="unit tests for the scoring math" />
        <TechRow name="Playwright" use="end-to-end tests of the map UI" />
        <TechRow name="GitHub Actions" use="scheduled data refreshes and CI on every pull request" />
        <TechRow name="Vercel" use="hosting, deployment, and analytics" />
        <TechRow name="Claude Code" use="AI-assisted development of the pipeline and frontend" />
      </ul>
    </div>
  );
}
