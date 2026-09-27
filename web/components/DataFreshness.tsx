'use client';

import { useEffect, useState } from 'react';

// Refresh runs monthly; past this the data is considered stale.
const STALE_AFTER_DAYS = 45;

// `inline` renders "Data updated <date>" text; otherwise renders only a banner when stale.
export default function DataFreshness({ inline = false }: { inline?: boolean }) {
  const [updated, setUpdated] = useState<Date | null>(null);

  useEffect(() => {
    fetch('/data/last_updated.json')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j?.updated && setUpdated(new Date(j.updated)))
      .catch(() => {});
  }, []);

  if (!updated) return null;
  const label = updated.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  if (inline) return <p style={{ fontSize: '0.9em', opacity: 0.8 }}>Data updated {label}.</p>;

  const ageDays = (Date.now() - updated.getTime()) / 86_400_000;
  if (ageDays < STALE_AFTER_DAYS) return null;
  return (
    <div
      role="status"
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 10000,
        background: '#fff4e5', color: '#663c00', padding: '6px 12px',
        fontSize: '13px', textAlign: 'center', borderBottom: '1px solid #f0c36d',
      }}
    >
      Heads up: this data was last refreshed {label} and may be out of date.
    </div>
  );
}
