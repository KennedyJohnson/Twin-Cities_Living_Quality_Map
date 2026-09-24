import Link from 'next/link';
import ScoreDrivers from '@/components/ScoreDrivers';

export default function ScoreDriversPage() {
  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', padding: '32px 20px', lineHeight: 1.6 }}>
      <Link href="/" style={{ fontSize: '13px', color: '#756bb1' }}>
        ← Back to map
      </Link>
      <h1 style={{ fontSize: '24px', fontWeight: 700, margin: '12px 0 24px' }}>
        What Actually Drives the Score
      </h1>

      <p style={{ marginBottom: '12px' }}>
        Nominal weights don&apos;t say which inputs actually move the score: a metric that barely
        differs between districts moves nothing, whatever its weight. To measure realized influence,
        we fit a linear surrogate model to each score across the 28 districts and explain it with{' '}
        <a href="https://shap.readthedocs.io" target="_blank" rel="noopener noreferrer" style={{ color: '#756bb1' }}>SHAP</a>.
        Each bar is an input&apos;s average absolute SHAP value: how many points it typically
        pushes a district above or below the average, shown as a share of all inputs combined.
        Inputs are correlated (e.g. poverty, income, and chronic disease move together), so credit
        among related inputs is approximate.
      </p>
      <ScoreDrivers />

    </div>
  );
}
