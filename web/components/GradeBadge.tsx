import { getLetterGrade, gradeColor } from '@/lib/letterGrade';

interface GradeBadgeProps {
  percentile: number | null;
  size?: 'small' | 'large';
}

export default function GradeBadge({ percentile, size = 'small' }: GradeBadgeProps) {
  if (percentile == null) return null;
  const grade = getLetterGrade(percentile);
  const color = gradeColor(grade);
  const isLarge = size === 'large';

  return (
    <span
      title={`Better than ${Math.round(percentile)}% of districts`}
      style={{
        display: 'inline-block',
        marginLeft: isLarge ? '10px' : '6px',
        padding: isLarge ? '2px 10px' : '1px 6px',
        borderRadius: '4px',
        fontSize: isLarge ? '20px' : '11px',
        fontWeight: 700,
        color: '#fff',
        background: color,
        verticalAlign: 'middle',
      }}
    >
      {grade}
    </span>
  );
}
