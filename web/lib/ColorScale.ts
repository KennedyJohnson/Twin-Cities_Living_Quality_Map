/**
 * Sequential single-hue purple scale, based on ColorBrewer's "Purples"
 * palette — chosen for strong contrast against the light basemap and
 * because purple isn't used by any point-layer marker color, so district
 * fill and point markers stay easy to tell apart.
 * Lighter purple = lower health score, darker purple = higher health score.
 *
 * Real health scores in this dataset cluster tightly (e.g. ~28-71 rather
 * than spanning the full 0-100 range), so colors are normalized against the
 * actual min/max in view rather than a fixed 0-100 scale — otherwise every
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
  [252, 251, 253], // #fcfbfd — low
  [239, 237, 245], // #efedf5
  [218, 218, 235], // #dadaeb
  [188, 189, 220], // #bcbddc
  [158, 154, 200], // #9e9ac8
  [128, 125, 186], // #807dba
  [106, 81, 163],  // #6a51a3
  [84, 39, 143],   // #54278f
  [63, 0, 125],    // #3f007d — high
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

export function getLegendColors(min: number = 0, max: number = 100): Array<{ value: number; color: string; label: string }> {
  const mid = (min + max) / 2;
  return [
    { value: min, color: getHealthScoreColor(min, min, max), label: `Poor (${Math.round(min)})` },
    { value: mid, color: getHealthScoreColor(mid, min, max), label: `Mid (${Math.round(mid)})` },
    { value: max, color: getHealthScoreColor(max, min, max), label: `Excellent (${Math.round(max)})` },
  ];
}
