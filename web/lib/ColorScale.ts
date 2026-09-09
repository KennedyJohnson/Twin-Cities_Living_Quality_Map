/**
 * Diverging Blue–Orange color scale (0 = poor, 100 = excellent).
 * Colorblind-safe palette based on research-backed colors.
 */

function hexToRgb(hex: string): [number, number, number] {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) throw new Error(`Invalid hex color: ${hex}`);
  return [
    parseInt(result[1], 16),
    parseInt(result[2], 16),
    parseInt(result[3], 16),
  ];
}

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

export function getHealthScoreColor(score: number): string {
  // Clamp score to [0, 100]
  const clamped = Math.max(0, Math.min(100, score));

  // Define color scale (diverging blue to orange)
  const blue: [number, number, number] = [27, 94, 155];      // Poor (#1b5e9b)
  const lightBlue: [number, number, number] = [76, 151, 204]; // Below avg (#4c97cc)
  const white: [number, number, number] = [240, 240, 240];   // Neutral (#f0f0f0)
  const lightOrange: [number, number, number] = [242, 160, 80]; // Above avg (#f2a050)
  const orange: [number, number, number] = [217, 103, 39];   // Excellent (#d96727)

  let color: [number, number, number];

  if (clamped < 25) {
    // Blue zone: 0–25
    const t = clamped / 25;
    color = interpolateColor(blue, lightBlue, t);
  } else if (clamped < 50) {
    // Light blue to white: 25–50
    const t = (clamped - 25) / 25;
    color = interpolateColor(lightBlue, white, t);
  } else if (clamped < 75) {
    // White to light orange: 50–75
    const t = (clamped - 50) / 25;
    color = interpolateColor(white, lightOrange, t);
  } else {
    // Light orange to orange: 75–100
    const t = (clamped - 75) / 25;
    color = interpolateColor(lightOrange, orange, t);
  }

  return rgbToHex(color[0], color[1], color[2]);
}

export function getLegendColors(): Array<{ value: number; color: string; label: string }> {
  return [
    { value: 0, color: getHealthScoreColor(0), label: 'Poor (0)' },
    { value: 25, color: getHealthScoreColor(25), label: 'Below Avg (25)' },
    { value: 50, color: getHealthScoreColor(50), label: 'Neutral (50)' },
    { value: 75, color: getHealthScoreColor(75), label: 'Above Avg (75)' },
    { value: 100, color: getHealthScoreColor(100), label: 'Excellent (100)' },
  ];
}
