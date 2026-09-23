'use client';

import { useEffect, useState } from 'react';
import type { Neighborhood } from '@/types/neighborhood';
import { boundsCenter, boundsForArea, Bounds, listingLinks, ListingFilters } from '@/lib/listingLinks';
import { estimateCommute, geocodeWorkAddress, setWorkLocation, useWorkLocation } from '@/lib/commute';

// "Moving here?" panel: plain-language character tags, typical housing costs,
// a rough commute to the user's job, and listing links for this exact area.

export function useAreaBounds(district: Neighborhood | null, center?: { lat: number; lon: number } | null) {
  const [bounds, setBounds] = useState<Bounds | null>(null);
  useEffect(() => {
    let cancelled = false;
    setBounds(null);
    if (district) boundsForArea(district, center).then((b) => !cancelled && setBounds(b));
    return () => {
      cancelled = true;
    };
  }, [district?.district_id, district?.is_radius, district?.is_zip, center?.lat, center?.lon]);
  return bounds;
}

export function ListingLinks({ district, bounds, filters }: { district: Neighborhood; bounds: Bounds | null; filters: ListingFilters }) {
  const { primary, fallback } = listingLinks(district, bounds, filters);
  return (
    <div>
      {primary.map((l) => (
        <a key={l.href} href={l.href} target="_blank" rel="noopener noreferrer" className="listing-link">
          <span>{l.label} on Zillow</span>
          <span aria-hidden>↗</span>
        </a>
      ))}
      <div style={{ fontSize: '11px', color: '#999', marginTop: '4px' }}>
        {primary.length > 0 ? 'Opens Zillow zoomed to this area. Map not lining up? Try ' : 'Search '}
        {fallback.map((l, i) => (
          <span key={l.href}>
            {i > 0 && ' · '}
            <a href={l.href} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>
              {l.label}
            </a>
          </span>
        ))}
      </div>
    </div>
  );
}

export function WorkAddressInput() {
  const work = useWorkLocation();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'notfound'>('idle');

  if (work) {
    return (
      <div style={{ fontSize: '12px', color: '#666' }}>
        Work: {work.label}{' '}
        <button type="button" onClick={() => setWorkLocation(null)} style={{ fontSize: '11px', background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', padding: 0 }}>
          change
        </button>
      </div>
    );
  }
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!query.trim()) return;
        setStatus('loading');
        const loc = await geocodeWorkAddress(query.trim()).catch(() => null);
        if (loc) {
          setWorkLocation(loc);
          setStatus('idle');
        } else setStatus('notfound');
      }}
      style={{ display: 'flex', gap: '6px' }}
    >
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Work or school address"
        style={{ flex: 1, fontSize: '12px', padding: '6px 8px', minWidth: 0 }}
      />
      <button type="submit" disabled={status === 'loading'} style={{ fontSize: '12px', padding: '5px 12px', cursor: 'pointer' }}>
        {status === 'loading' ? '…' : 'Set'}
      </button>
      {status === 'notfound' && <span style={{ fontSize: '11px', color: '#c0392b' }}>Not found</span>}
    </form>
  );
}

export function CommuteLine({ from }: { from: { lat: number; lon: number } | null }) {
  const work = useWorkLocation();
  if (!work || !from) return null;
  const c = estimateCommute(from, work);
  return (
    <div style={{ fontSize: '12px', color: '#444', marginTop: '4px' }}>
      ~{c.miles.toFixed(1)} mi · 🚗 ~{c.driveMin} min · 🚌 ~{c.transitMin} min · 🚲 ~{c.bikeMin} min
    </div>
  );
}

export interface AreaGuideProps {
  district: Neighborhood;
  center?: { lat: number; lon: number } | null;
  // Percentile (0-100) of this area among its comparison pool, per index key.
  percentiles: Record<string, number | null>;
  rent: number | null | undefined;
  homeValue: number | null | undefined;
  avgRent: number | null;
  avgHomeValue: number | null;
  homeownershipRate: number | null | undefined;
  medianAge: number | null | undefined;
  filters: ListingFilters;
}

function vsAvg(value: number, avg: number | null): string {
  if (!avg) return '';
  const pct = Math.round(((value - avg) / avg) * 100);
  if (Math.abs(pct) < 5) return ' (about average)';
  return ` (${Math.abs(pct)}% ${pct < 0 ? 'below' : 'above'} avg)`;
}

function characterTags(p: AreaGuideProps): string[] {
  const tags: string[] = [];
  const hi = (k: string) => (p.percentiles[k] ?? 50) >= 70;
  const lo = (k: string) => (p.percentiles[k] ?? 50) <= 30;
  if (hi('walkability_score')) tags.push('Very walkable');
  else if (lo('walkability_score')) tags.push('More car-dependent');
  if (hi('amenities')) tags.push('Lots of shops, restaurants & services');
  else if (lo('amenities')) tags.push('Quieter, fewer amenities nearby');
  if (hi('safety')) tags.push('Lower crime & crash rates');
  else if (lo('safety')) tags.push('Higher crime or crash rates');
  if (hi('transportation')) tags.push('Good transit & trails');
  if (p.homeownershipRate != null) {
    if (p.homeownershipRate >= 60) tags.push('Mostly owner-occupied homes');
    else if (p.homeownershipRate <= 40) tags.push('Mostly renters / apartments');
    else tags.push('Mix of renters & owners');
  }
  if (p.medianAge != null) {
    if (p.medianAge < 32) tags.push('Younger population');
    else if (p.medianAge > 42) tags.push('Older, settled population');
  }
  return tags;
}

export default function AreaGuide(props: AreaGuideProps) {
  const { district, center, rent, homeValue, avgRent, avgHomeValue, filters } = props;
  const bounds = useAreaBounds(district, center);
  const origin = district.is_radius ? center ?? null : bounds ? boundsCenter(bounds) : null;
  const tags = characterTags(props);
  const overRent = filters.maxRent != null && rent != null && rent > filters.maxRent;
  const overPrice = filters.maxHomeValue != null && homeValue != null && homeValue > filters.maxHomeValue;
  const note = district.is_radius ? ' (surrounding district)' : '';

  return (
    <div className="area-guide">
      <div className="area-guide-title">Moving here?</div>
      {tags.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '10px' }}>
          {tags.map((t) => (
            <span key={t} className="tag-chip">
              {t}
            </span>
          ))}
        </div>
      )}
      {(rent != null || homeValue != null) && (
        <div style={{ fontSize: '12px', color: '#444', lineHeight: 1.6, marginBottom: '10px' }}>
          {rent != null && (
            <div style={overRent ? { color: '#c0392b' } : undefined}>
              Typical rent: <strong>${rent.toLocaleString()}/mo</strong>
              {vsAvg(rent, avgRent)}
              {overRent && ' · over your budget'}
            </div>
          )}
          {homeValue != null && (
            <div style={overPrice ? { color: '#c0392b' } : undefined}>
              Typical home value: <strong>${homeValue.toLocaleString()}</strong>
              {vsAvg(homeValue, avgHomeValue)}
              {overPrice && ' · over your budget'}
            </div>
          )}
          <div style={{ fontSize: '11px', color: '#999' }}>Census medians{note}; current listings may differ.</div>
        </div>
      )}
      <div className="area-guide-heading">Commute</div>
      <WorkAddressInput />
      <CommuteLine from={origin} />
      {origin && <div style={{ fontSize: '11px', color: '#999' }}>Rough estimate from {district.is_radius ? 'this point' : 'the area’s center'}, not live routing.</div>}
      <div className="area-guide-heading">Find a place</div>
      <ListingLinks district={district} bounds={bounds} filters={filters} />
    </div>
  );
}
