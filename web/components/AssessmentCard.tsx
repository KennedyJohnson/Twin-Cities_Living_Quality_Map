'use client';

import { useEffect, useState } from 'react';
import { cityForDistrictId } from '@/lib/geo';
import type { Neighborhood } from '@/types/neighborhood';

// Cross-link to the companion Minneapolis property-assessment checker
// (github.com/KennedyJohnson/twin-cities-property-assessment). It publishes a
// per-neighborhood summary of how the city's assessed values compare with an
// independent sale-price model; we roll those neighborhoods up into this
// map's Minneapolis communities with the same crosswalk the pipeline uses.
export const ASSESSMENT_URL = 'https://kennedyjohnson.github.io/twin-cities-property-assessment/';

interface NbStats {
  homes: number;
  compared: number;
  median_ratio: number;
  share_high: number;
  share_low: number;
}

const key = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

let dataPromise: Promise<{ stats: Record<string, NbStats>; year: number; crosswalk: Record<string, string> } | null> | null = null;
function loadData() {
  if (!dataPromise) {
    dataPromise = Promise.all([
      fetch(`${ASSESSMENT_URL}data/neighborhoods.json`).then((r) => (r.ok ? r.json() : null)),
      fetch('/data/mpls_neighborhood_to_community.json').then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([a, crosswalk]) => {
        if (!a || !crosswalk) return null;
        const stats: Record<string, NbStats> = {};
        for (const [nb, s] of Object.entries(a.neighborhoods as Record<string, NbStats>)) stats[key(nb)] = s;
        return { stats, year: a.assessment_year, crosswalk };
      })
      .catch(() => null);
  }
  return dataPromise;
}

// "3217, 48th Avenue South, Cooper, Minneapolis, ..." -> "3217 48th Avenue South"
function streetAddress(display: string): string | null {
  const parts = display.split(',').map((p) => p.trim());
  if (/^\d+[A-Za-z]?$/.test(parts[0]) && parts[1]) return `${parts[0]} ${parts[1]}`;
  if (/^\d+\s/.test(parts[0])) return parts[0];
  return null;
}

export default function AssessmentCard({ district }: { district: Neighborhood }) {
  const cityId = district.is_radius ? district.containing_district_id : district.district_id;
  const isMpls = !district.is_zip && cityId != null && cityForDistrictId(cityId) === 'mpls';
  const [data, setData] = useState<Awaited<ReturnType<typeof loadData>>>(null);

  useEffect(() => {
    if (isMpls && !district.is_radius) loadData().then(setData);
  }, [isMpls, district.is_radius]);

  if (!isMpls) return null;

  const street = district.is_radius && district.address ? streetAddress(district.address) : null;
  if (district.is_radius) {
    if (!street) return null;
    return (
      <div className="assessment-card">
        <a href={`${ASSESSMENT_URL}#${encodeURIComponent(street)}`} target="_blank" rel="noopener noreferrer">
          Is this home&apos;s property-tax value fair? Check its assessment ↗
        </a>
      </div>
    );
  }

  let summary: { compared: number; ratio: number; high: number } | null = null;
  if (data) {
    const nbs = Object.entries(data.crosswalk)
      .filter(([, community]) => key(community) === key(district.district_name))
      .map(([nb]) => data.stats[key(nb)])
      .filter(Boolean);
    const compared = nbs.reduce((t, s) => t + s.compared, 0);
    // Downtown (Central) has only a handful of single-family homes; too few to summarize.
    if (compared >= 100) {
      summary = {
        compared,
        ratio: nbs.reduce((t, s) => t + s.median_ratio * s.compared, 0) / compared,
        high: nbs.reduce((t, s) => t + s.share_high * s.compared, 0) / compared,
      };
    }
  }

  return (
    <div className="assessment-card">
      <div className="assessment-card-title">Property-tax assessments</div>
      {summary ? (
        <p>
          Across {summary.compared.toLocaleString()} single-family homes, the city&apos;s {data!.year} values run{' '}
          <b>
            {Math.abs(summary.ratio - 1) < 0.02
              ? 'about even with'
              : `${Math.round(Math.abs(summary.ratio - 1) * 100)}% ${summary.ratio > 1 ? 'above' : 'below'}`}
          </b>{' '}
          what homes here would sell for. About {Math.round(summary.high * 100)}% look assessed on the high side.
        </p>
      ) : (
        <p>See how the city&apos;s assessed values compare with what similar homes sold for.</p>
      )}
      <a href={ASSESSMENT_URL} target="_blank" rel="noopener noreferrer">
        Look up a home&apos;s assessment ↗
      </a>
    </div>
  );
}
