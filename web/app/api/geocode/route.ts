import { NextRequest, NextResponse } from 'next/server';

// Proxies Nominatim search so requests carry a proper User-Agent — browsers
// won't let client-side fetch() set one, and Nominatim's usage policy
// requires it to identify the app, so direct client calls can be silently
// rate-limited/blocked even when the same query works server-side.
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get('q');
  if (!q) {
    return NextResponse.json({ error: 'Missing q parameter' }, { status: 400 });
  }

  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
    q
  )}&bounded=1&viewbox=-93.4,44.8,-92.8,45.1&limit=10`;

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'TwinCitiesLivingQualityMap/1.0 (https://github.com/KennedyJohnson/Twin-Cities_Living_Quality_Map)',
    },
  });

  if (!response.ok) {
    return NextResponse.json({ error: 'Nominatim request failed' }, { status: response.status });
  }

  const data = await response.json();
  return NextResponse.json(data);
}
