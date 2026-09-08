import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'St. Paul Neighborhood Health Map',
  description: 'Interactive health score visualization for St. Paul District Councils',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
