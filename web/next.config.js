/** @type {import('next').NextConfig} */
const nextConfig = {
  // react-leaflet 4.x doesn't clean up its Leaflet map instance correctly
  // across React 18 Strict Mode's dev-only double-mount, which throws "Map
  // container is already initialized" on load/hot-reload. No effect on the
  // production build either way (Strict Mode's double-invoke is dev-only).
  reactStrictMode: false,
  // Next 16 otherwise regenerates web/AGENTS.md + web/CLAUDE.md on every
  // dev/build run — this repo already has its own root CLAUDE.md.
  agentRules: false,
  async headers() {
    return [
      {
        // web/public/data/*.json + *.geojson — the pipeline's exported
        // datasets. Not content-hashed (same URL every deploy), and the
        // weekly refresh (.github/workflows/refresh-data.yml) redeploys with
        // updated content at that same URL, so this can't be `immutable`
        // like a hashed build asset — that would let browsers/CDN keep
        // serving pre-refresh data indefinitely. A 1-hour edge/browser cache
        // with a day of stale-while-revalidate still cuts repeat-visit
        // network time way down (no more re-fetching the same ~20MB of
        // point/boundary data every single load) while staying well under
        // the weekly refresh cadence.
        source: '/data/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400',
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
