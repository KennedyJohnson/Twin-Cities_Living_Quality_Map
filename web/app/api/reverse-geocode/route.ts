import { NextRequest, NextResponse } from 'next/server';

// Proxies Nominatim reverse geocoding (same reasoning as /api/geocode: a
// server-side User-Agent header is required by Nominatim's usage policy and
// browsers won't let client fetch() set one). Used to backfill a street
// address for local place-index search results that don't carry one (e.g. a
// named shop/amenity node with no addr:housenumber/addr:street of its own).
export async function GET(request: NextRequest) {
  const lat = request.nextUrl.searchParams.get('lat');
  const lon = request.nextUrl.searchParams.get('lon');
  if (!lat || !lon) {
    return NextResponse.json({ error: 'Missing lat/lon parameter' }, { status: 400 });
  }

  const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${encodeURIComponent(
    lat
  )}&lon=${encodeURIComponent(lon)}&zoom=18`;

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
