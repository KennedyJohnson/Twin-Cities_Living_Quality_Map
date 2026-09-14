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
        time.
      </p>

      <p style={{ marginBottom: '20px', fontSize: '14px', color: '#666', fontStyle: 'italic' }}>
        The Living Quality Score is a comparative index, not an objective measure of quality of
        life — it reflects a specific choice of metrics, geography, normalization, and weighting,
        and is only as complete as the public data available for each city. Use it to compare
        districts against each other, not as a verdict on any one of them.
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
        <TechRow name="OpenStreetMap" href="https://www.openstreetmap.org/" use="trails, transit stops, schools, grocery stores, restaurants/bars, healthcare facilities, street network (Walk/Bike Score)" />
        <TechRow name="Overpass API" href="https://overpass-api.de/" use="queries the OpenStreetMap data above" />
        <TechRow name="U.S. Census Bureau ACS 5-Year Estimates" href="https://www.census.gov/programs-surveys/acs" use="median home value, gross rent, household income, poverty rate, housing cost burden, homeownership rate, unemployment rate, broadband/internet access" />
        <TechRow name="Zillow Research" href="https://www.zillow.com/research/data/" use="for-sale home listing inventory by ZIP, used as a housing-market tightness signal" />
        <TechRow name="MnDOT Traffic Forecasting & Analysis" href="https://www.dot.state.mn.us/traffic/data/" use="Annual Average Daily Traffic (AADT) volumes and pedestrian/cyclist crash locations" />
        <TechRow name="CDC PLACES" href="https://www.cdc.gov/places/" use="obesity and diabetes prevalence by census tract" />
        <TechRow name="FEMA National Risk Index" href="https://hazards.fema.gov/nri/" use="natural hazard risk score by census tract" />
      </ul>

      <h2 style={{ fontSize: '18px', fontWeight: 600, marginTop: '32px', marginBottom: '12px' }}>
        How We Calculate This
      </h2>

      <p style={{ marginBottom: '20px' }}>
        Every district gets an overall <strong>Living Quality Score</strong> (0–100) built from five
        component indices, each also scored 0–100:
      </p>

      <ul style={{ marginBottom: '24px', paddingLeft: '20px' }}>
        <li><strong>Safety &amp; Health (20%)</strong>: crime rate, pedestrian/cyclist crash rate, natural hazard risk, and chronic disease burden (obesity/diabetes prevalence), all inverted</li>
        <li><strong>Opportunity (20%)</strong>: building permit rate per capita, unemployment rate (inverted), and Zillow for-sale home-listing tightness (fewer listings relative to population reads as a tighter, more in-demand market)</li>
        <li><strong>Amenities &amp; Services (20%)</strong>: schools, grocery stores, restaurants/bars, and healthcare access, blended 85/15 with a Census broadband/internet-access rate</li>
        <li><strong>Transportation (20%)</strong>: trail/path length and transit stop rate, minus traffic volume (inverted); blended 70/30 with a Zillow-style Walk/Bike Score (distance-decay proximity to daily-need amenities plus street-intersection density)</li>
        <li><strong>Affordability (20%)</strong>: Census median home value, rent, poverty rate, and housing cost burden (all inverted), plus median household income and homeownership rate</li>
      </ul>

      <p style={{ marginBottom: '20px' }}>
        All 28 districts across both cities (17 St. Paul District Councils + 11 Minneapolis
        Communities) are normalized together in one pool, not city-by-city; otherwise a St.
        Paul district&apos;s &quot;72&quot; and a Minneapolis district&apos;s &quot;72&quot; wouldn&apos;t
        actually mean the same thing. Crime and permit counts are also restricted to a shared
        trailing recent-years window before they&apos;re turned into rates, so the two
        cities&apos; differing lengths of data history (e.g. one dataset going back to 2014,
        another only to 2019) don&apos;t skew which city looks safer or more active than it
        really is.
      </p>

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
        asymptotically instead: extreme districts land near, but never exactly at, the floor or
        ceiling.
      </p>

      <h3 style={{ fontSize: '16px', fontWeight: 600, marginTop: '24px', marginBottom: '12px' }}>
        Step 3: Direction
      </h3>
      <p style={{ marginBottom: '20px' }}>
        Some metrics are inverted before blending, because a higher raw number is worse, not
        better: crime rate, traffic volume, and housing cost are all inverted so that a{' '}
        <em>lower</em> rate produces a <em>higher</em> index score.
      </p>

      <h3 style={{ fontSize: '16px', fontWeight: 600, marginTop: '24px', marginBottom: '12px' }}>
        Step 4: Blend into indices, then into one score
      </h3>
      <p style={{ marginBottom: '20px' }}>
        Within a component (e.g. Amenities &amp; Services), each metric&apos;s normalized value is combined
        into a single index using a weighted average. The five indices are then combined into the
        overall Living Quality Score using the weights above (20/20/20/20/20). Equal weighting was
        chosen deliberately, to avoid imposing a subjective preference for any one dimension of
        quality of life over another — a district-by-district breakdown of all five is always
        shown alongside the overall score, so you can weigh them differently yourself.
      </p>

      <h3 style={{ fontSize: '16px', fontWeight: 600, marginTop: '24px', marginBottom: '12px' }}>
        1-Mile Radius Scores
      </h3>
      <p style={{ marginBottom: '20px' }}>
        Clicking anywhere on the map or searching an address computes a score for that point&apos;s
        1-mile radius, rather than just the enclosing district. This is estimated from OpenStreetMap
        and Census data within 1 mile using per-area rates. It excludes metrics only available at the
        district level (weight redistributed among the remaining metrics) and the Walk/Bike Score&apos;s
        distance decay. District scores use the full metric set described above.
      </p>

      <h3 style={{ fontSize: '16px', fontWeight: 600, marginTop: '24px', marginBottom: '12px' }}>
        ZIP Code Scores
      </h3>
      <p style={{ marginBottom: '20px' }}>
        The map&apos;s &quot;Map view: District / ZIP Code&quot; toggle switches to a finer-grained
        geography: every ZIP code in the Twin Cities is scored the same way districts are, but
        normalized in its own separate pool: every ZIP compared directly against every other ZIP,
        not against districts or split per city. A ZIP&apos;s score, letter grade, and
        &quot;this ZIP vs. other ZIPs&quot; comparisons are only meaningful relative to other ZIPs,
        the same way a district score is only meaningful relative to other districts: the two
        pools use different normalizations and aren&apos;t on a directly comparable 0–100 scale to
        each other.
      </p>
      <p style={{ marginBottom: '20px' }}>
        Only ZIP codes with at least 98% of their area inside St. Paul or Minneapolis&apos;s
        combined district boundaries are included (currently 27 of the ~49 ZCTAs that touch the
        metro area). A ZIP that only clips a corner of a district has most of its area and
        population outside our data coverage. Crime, permits, and every other source come from
        the two cities&apos; own feeds, not the surrounding suburbs, so scoring it anyway would
        divide a real population by an artificially small incident count and understate every
        rate. The threshold is a large-majority-area test rather than exact polygon containment,
        since real-world administrative boundaries rarely align to the pixel.
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
        <TechRow name="NumPy" use="the score normalization math" />
        <TechRow name="pytest" use="unit tests for the scoring math" />
        <TechRow name="Playwright" use="end-to-end tests of the map UI" />
        <TechRow name="GitHub Actions" use="scheduled data refreshes and CI on every pull request" />
        <TechRow name="Vercel" use="hosting, deployment, and analytics" />
        <TechRow name="Claude Code" use="AI-assisted development of the pipeline and frontend" />
      </ul>

      <p style={{ fontSize: '12px', color: '#999', marginTop: '32px' }}>
        St. Paul&apos;s crime data has no geocoded address in the source, only a district, so
        individual crime incidents aren&apos;t plotted as markers on the map (Minneapolis crime
        does include real coordinates and is plotted). St. Paul crime still fully feeds the
        Safety index and district-level Crime Rate metric.
      </p>
    </div>
  );
}
