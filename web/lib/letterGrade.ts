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

export function gradeColor(grade: LetterGrade): string {
  switch (grade) {
    case 'A': return '#2e7d32';
    case 'B': return '#66a61e';
    case 'C': return '#b8a000';
    case 'D': return '#d97706';
    case 'F': return '#c0392b';
  }
}
