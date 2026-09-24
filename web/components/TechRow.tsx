export default function TechRow({ name, href, use }: { name: string; href?: string; use: string }) {
  return (
    <li style={{ marginBottom: '8px' }}>
      <strong>
        {href ? (
          <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: '#756bb1' }}>
            {name}
          </a>
        ) : (
          name
        )}
      </strong>{': '}
      {use}
    </li>
  );
}
