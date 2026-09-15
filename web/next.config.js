/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
