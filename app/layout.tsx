import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'Observation Lab · Carruthers',
  icons: { icon: 'data:,' },
  description:
    'Local exploration and measurement of Carruthers GCI observations.',
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <body>{children}</body>
    </html>
  );
}
