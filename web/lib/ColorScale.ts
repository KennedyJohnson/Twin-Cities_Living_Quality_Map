/**
 * Sequential "Lakes & Paper" scale (birch paper -> pine -> deep lake,
 * a YlGnBu-like ramp) - chosen for strong contrast against the light basemap and
 * because purple isn't used by any point-layer marker color, so district
 * fill and point markers stay easy to tell apart.
 * Lighter purple = lower health score, darker purple = higher health score.
 *
 * Real health scores in this dataset cluster tightly (e.g. ~28-71 rather
 * than spanning the full 0-100 range), so colors are normalized against the
 * actual min/max in view rather than a fixed 0-100 scale - otherwise every
 * district lands in the same narrow middle slice of the gradient and looks
 * nearly identical. Pass the current score domain via `min`/`max`.
 */

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map(x => Math.round(x).toString(16).padStart(2, '0')).join('')}`;
}

function interpolateColor(
  color1: [number, number, number],
  color2: [number, number, number],
  t: number
): [number, number, number] {
  return [
    color1[0] + (color2[0] - color1[0]) * t,
    color1[1] + (color2[1] - color1[1]) * t,
    color1[2] + (color2[2] - color1[2]) * t,
  ];
}

// ColorBrewer "Purples" 9-class sequential stops (wider range + more steps
// than the 5-class version, so districts with similar-but-different scores
// are still visibly distinct instead of collapsing into near-identical hues).
const PURPLE_STOPS: [number, number, number][] = [
  [247, 243, 232], // #f7f3e8 - low (birch paper)
  [230, 236, 214], // #e6ecd6
  [199, 220, 192], // #c7dcc0
  [156, 198, 173], // #9cc6ad
  [106, 169, 154], // #6aa99a
  [67, 137, 138],  // #43898a
  [43, 107, 120],  // #2b6b78
  [29, 79, 99],    // #1d4f63
  [18, 54, 74],    // #12364a - high (deep lake)
];

export function getHealthScoreColor(score: number, min: number = 0, max: number = 100): string {
  const range = max - min;
  const t = range > 0 ? Math.max(0, Math.min(1, (score - min) / range)) : 0.5;

  const scaledT = t * (PURPLE_STOPS.length - 1);
  const idx = Math.min(Math.floor(scaledT), PURPLE_STOPS.length - 2);
  const localT = scaledT - idx;

  const color = interpolateColor(PURPLE_STOPS[idx], PURPLE_STOPS[idx + 1], localT);
  return rgbToHex(color[0], color[1], color[2]);
}

export function getLegendColors(min: number = 0, max: number = 100, steps: number = 7): Array<{ value: number; color: string; label: string }> {
  const swatches = [];
  for (let i = 0; i < steps; i++) {
    const value = min + (max - min) * (i / (steps - 1));
    swatches.push({
      value,
      color: getHealthScoreColor(value, min, max),
      label: `${Math.round(value)}`,
    });
  }
  return swatches;
}
