'use client';

import { useEffect, useState } from 'react';
import { haversineMeters } from '@/lib/matchRegions';

// "Near my job" commute estimate. There's no routing API behind this (real
// transit times would need a paid one) — it's straight-line distance times a
// typical road-network detour factor, divided by rough average metro speeds
// plus fixed overhead (parking / waiting for a bus). Good enough to tell a
// 10-minute commute from a 40-minute one, and labeled as an estimate
// everywhere it's shown.

export interface WorkLocation {
  lat: number;
  lon: number;
  label: string;
}

const STORAGE_KEY = 'tc-work-location';
const CHANGE_EVENT = 'tc-work-location-change';

const DETOUR_FACTOR = 1.3;
const MODES = {
  drive: { kmh: 40, overheadMin: 4 },
  transit: { kmh: 16, overheadMin: 10 },
  bike: { kmh: 15, overheadMin: 0 },
} as const;

export interface CommuteEstimate {
  miles: number;
  driveMin: number;
  transitMin: number;
  bikeMin: number;
}

export function estimateCommute(from: { lat: number; lon: number }, to: WorkLocation): CommuteEstimate {
  const km = (haversineMeters(from.lat, from.lon, to.lat, to.lon) / 1000) * DETOUR_FACTOR;
  const minutes = (m: keyof typeof MODES) => Math.max(1, Math.round((km / MODES[m].kmh) * 60 + MODES[m].overheadMin));
  return { miles: km / 1.609, driveMin: minutes('drive'), transitMin: minutes('transit'), bikeMin: minutes('bike') };
}

function readStored(): WorkLocation | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setWorkLocation(loc: WorkLocation | null): void {
  try {
    if (loc) localStorage.setItem(STORAGE_KEY, JSON.stringify(loc));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage blocked (private window) — still update this tab's listeners.
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: loc }));
}

// Shared across the sidebar, compare view and Match Finder so setting the
// work address in one updates the others.
export function useWorkLocation(): WorkLocation | null {
  const [loc, setLoc] = useState<WorkLocation | null>(null);
  useEffect(() => {
    setLoc(readStored());
    const onChange = (e: Event) => setLoc((e as CustomEvent<WorkLocation | null>).detail);
    window.addEventListener(CHANGE_EVENT, onChange);
    return () => window.removeEventListener(CHANGE_EVENT, onChange);
  }, []);
  return loc;
}

export async function geocodeWorkAddress(query: string): Promise<WorkLocation | null> {
  const res = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`);
  if (!res.ok) return null;
  const results = await res.json();
  const first = Array.isArray(results) ? results[0] : null;
  if (!first) return null;
  return {
    lat: Number(first.lat),
    lon: Number(first.lon),
    label: String(first.display_name ?? query).split(',').slice(0, 2).join(','),
  };
}
