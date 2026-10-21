// Keeps the free Supabase project from pausing for inactivity by running a few of the
// map's own read queries on a schedule. GitHub's supabase-keepalive.yml is the backup.
const QUERIES = [
  ['GET', 'rest/v1/refresh_runs?select=run_at&order=run_at.desc&limit=1'],
  ['GET', 'rest/v1/area_snapshots?select=area_id&limit=1'],
  // Tiny bbox around downtown St. Paul, same RPC the houses layer calls.
  ['POST', 'rest/v1/rpc/houses_in_bbox', { min_lon: -93.10, min_lat: 44.94, max_lon: -93.09, max_lat: 44.95, max_rows: 1 }],
];

async function ping(env) {
  const results = [];
  for (const [method, path, body] of QUERIES) {
    const res = await fetch(`${env.SUPABASE_URL}/${path}`, {
      method,
      headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    results.push(`${path.split('?')[0]} ${res.status}`);
    if (!res.ok) throw new Error(`Supabase keepalive failed: ${results.join(', ')} ${await res.text()}`);
  }
  console.log(results.join(', '));
  return results;
}

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(ping(env));
  },
};
