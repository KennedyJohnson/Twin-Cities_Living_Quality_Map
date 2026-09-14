import { getHealthScoreColor } from './ColorScale';

export type LetterGrade = 'A' | 'B' | 'C' | 'D' | 'F';

// Health Score and each component index are z-score-normalized against the
// district set and squashed through a logistic curve (see the About page
// methodology) — that keeps raw values clustered tightly around 50 even
// for real, meaningful differences between districts, and averaging
// several such indices into one score compresses the spread further
// still. Fixed absolute cutoffs (90/80/70/60, like a school grade) would
// therefore grade almost every district D or F, which wouldn't reflect
// anything real about the district. Grades are relative instead: a
// district's percentile rank among the other districts for that same
// metric, banded like a curve.
export function percentileRank(value: number, allValues: number[]): number {
  if (allValues.length === 0) return 50;
  const below = allValues.filter((v) => v < value).length;
  const equal = allValues.filter((v) => v === value).length;
  return ((below + equal / 2) / allValues.length) * 100;
}

export function getLetterGrade(percentile: number): LetterGrade {
  if (percentile >= 90) return 'A';
  if (percentile >= 70) return 'B';
  if (percentile >= 40) return 'C';
  if (percentile >= 15) return 'D';
  return 'F';
}

// One fixed color per letter grade, sampled from the same purple sequential
// scale used for the map fill (ColorScale.ts) — so grade badges use the same
// low->high color language as the rest of the site, while every district
// sharing a letter grade still renders as the exact same shade (grades are a
// discrete category, not a continuous value). Stops are evenly spaced across
// the full scale (rather than at each grade band's percentile midpoint) so
// adjacent grades — especially A vs. B, both drawn from the dark end of the
// percentile range — stay visually distinct instead of collapsing into
// near-identical dark purple.
const GRADE_MIDPOINTS: Record<LetterGrade, number> = {
  F: 0,
  D: 25,
  C: 50,
  B: 75,
  A: 100,
};

export function gradeColor(grade: LetterGrade): string {
  return getHealthScoreColor(GRADE_MIDPOINTS[grade], 0, 100);
}

// Purple stops below the midpoint are light enough that white badge text
// would be unreadable, so badges need dark text there instead.
export function gradeTextColor(grade: LetterGrade): string {
  return GRADE_MIDPOINTS[grade] < 50 ? '#333' : '#fff';
}
