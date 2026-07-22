import type { Metadata } from 'next';
import './globals.css';
import { fetchSettings } from '@/lib/settings';
import { AuthProvider } from '@/lib/auth-context';
import { SiteHeader } from './site-header';

// Settings (app name, logo, tagline) are admin-editable and must reflect
// immediately — Next's Full Route Cache can still cache a route's HTML
// even when its fetches use `cache: 'no-store'` unless the route is
// explicitly opted out of static rendering.
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const settings = await fetchSettings();
  return {
    title: settings.appName,
    description: settings.tagline ?? 'Ugandan movies and series, streamed.',
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const settings = await fetchSettings();

  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <SiteHeader settings={settings} />
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
