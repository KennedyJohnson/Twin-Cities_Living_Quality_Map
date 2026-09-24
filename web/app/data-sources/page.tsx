import Link from 'next/link';
import TechRow from '@/components/TechRow';

export default function DataSourcesPage() {
  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', padding: '32px 20px', lineHeight: 1.6 }}>
      <Link href="/" style={{ fontSize: '13px', color: '#756bb1' }}>
        ← Back to map
      </Link>
      <h1 style={{ fontSize: '24px', fontWeight: 700, margin: '12px 0 24px' }}>
        Data Sources
      </h1>

      <p style={{ marginBottom: '20px' }}>
        Data is refreshed automatically on the 1st of every month via a scheduled GitHub Actions pipeline run.
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
        <TechRow name="Supabase" href="https://supabase.com/" use="PostGIS database holding ~100K OpenStreetMap houses (the Houses map layer and Find Your Match) and a month-by-month history of every district and ZIP score" />
        <TechRow name="FEMA National Risk Index" href="https://hazards.fema.gov/nri/" use="natural hazard risk score by census tract" />
      </ul>
      <p style={{ fontSize: '12px', color: '#999', marginBottom: '24px' }}>
        St. Paul&apos;s crime data has no geocoded address in the source, only a district, so
        individual crime incidents aren&apos;t plotted as markers on the map (Minneapolis crime
        does include real coordinates and is plotted). St. Paul crime still fully feeds the
        Safety index and district-level Crime Rate metric.
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
        <TechRow name="SHAP" use="explaining which inputs drive the score (Score Drivers page)" />
        <TechRow name="Supabase / PostGIS" use="score history and the viewport-loaded Houses layer" />
        <TechRow name="pytest" use="unit tests for the scoring math" />
        <TechRow name="Playwright" use="end-to-end tests of the map UI" />
        <TechRow name="GitHub Actions" use="scheduled data refreshes and CI on every pull request" />
        <TechRow name="Vercel" use="hosting, deployment, and analytics" />
        <TechRow name="Claude Code" use="AI-assisted development of the pipeline and frontend" />
      </ul>
    </div>
  );
}
