import { MatchComponent, MatchWeights } from '@/lib/scoreMetric';

// "Personal weights" let a visitor re-weight the five components of the
// Overall Living Quality Score. Each slider is an integer 0-10. Equal weights
// reproduce the published score (which is an equal-weight blend), so the map
// only switches to a custom blend once the weights are actually unequal.

export const PERSONAL_WEIGHT_MIN = 0;
export const PERSONAL_WEIGHT_MAX = 10;
const PERSONAL_WEIGHT_DEFAULT = 5;

export const PERSONAL_COMPONENT_ORDER: MatchComponent[] = [
  'safety',
  'opportunity',
  'amenities',
  'transportation',
  'affordability',
];

export const DEFAULT_PERSONAL_WEIGHTS: MatchWeights = {
  safety: PERSONAL_WEIGHT_DEFAULT,
  opportunity: PERSONAL_WEIGHT_DEFAULT,
  amenities: PERSONAL_WEIGHT_DEFAULT,
  transportation: PERSONAL_WEIGHT_DEFAULT,
  affordability: PERSONAL_WEIGHT_DEFAULT,
};

export const PERSONAL_WEIGHTS_STORAGE_KEY = 'lqm-personal-weights';
const HASH_KEY = 'weights';

export function isEqualWeights(weights: MatchWeights): boolean {
  const values = PERSONAL_COMPONENT_ORDER.map((c) => weights[c]);
  return values.every((v) => v === values[0]);
}

// Serializes to "safety:5,opportunity:5,..." in a fixed component order.
export function serializeWeights(weights: MatchWeights): string {
  return PERSONAL_COMPONENT_ORDER.map((c) => `${c}:${weights[c]}`).join(',');
}

// Defensive parse: unknown keys are ignored, values are rounded and clamped,
// and components missing from the input fall back to the default. Returns
// null when nothing usable was found, so callers can fall back to storage.
export function parseWeights(raw: string | null | undefined): MatchWeights | null {
  if (!raw) return null;
  const result: MatchWeights = { ...DEFAULT_PERSONAL_WEIGHTS };
  let found = 0;
  for (const part of raw.split(',')) {
    const [key, value] = part.split(':');
    if (!key || value === undefined) continue;
    const component = PERSONAL_COMPONENT_ORDER.find((c) => c === key.trim());
    if (!component) continue;
    const num = Number(value.trim());
    if (!Number.isFinite(num)) continue;
    result[component] = Math.min(PERSONAL_WEIGHT_MAX, Math.max(PERSONAL_WEIGHT_MIN, Math.round(num)));
    found++;
  }
  return found > 0 ? result : null;
}

// Reads "#weights=..." from a location hash. Other fragment content is ignored.
export function parseWeightsFromHash(hash: string): MatchWeights | null {
  const body = hash.startsWith('#') ? hash.slice(1) : hash;
  const prefix = `${HASH_KEY}=`;
  const part = body.split('&').find((p) => p.startsWith(prefix));
  return parseWeights(part ? part.slice(prefix.length) : null);
}

// Writes the weights to the URL hash with history.replaceState, which does not
// fire hashchange, and keeps location.search intact. Default weights clear the
// hash so the plain URL stays clean. Storage is written alongside as a
// per-visitor fallback for when the hash is absent.
export function persistWeights(weights: MatchWeights): void {
  const isDefault = isEqualWeights(weights);
  try {
    const url = new URL(window.location.href);
    url.hash = isDefault ? '' : `${HASH_KEY}=${serializeWeights(weights)}`;
    window.history.replaceState(window.history.state, '', url.toString());
  } catch {
    // URL or history unavailable: the in-memory state still works.
  }
  try {
    if (isDefault) window.localStorage.removeItem(PERSONAL_WEIGHTS_STORAGE_KEY);
    else window.localStorage.setItem(PERSONAL_WEIGHTS_STORAGE_KEY, serializeWeights(weights));
  } catch {
    // Private mode or blocked storage: fall back to the hash alone.
  }
}

export function readStoredWeights(): MatchWeights | null {
  try {
    return parseWeights(window.localStorage.getItem(PERSONAL_WEIGHTS_STORAGE_KEY));
  } catch {
    return null;
  }
}
