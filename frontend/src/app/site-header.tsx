import Link from 'next/link';
import type { AppSettings } from '@/lib/settings';
import { HeaderAuth } from './header-auth';

export function SiteHeader({ settings }: { settings: AppSettings }) {
  return (
    <header className="header">
      <Link href="/" className="brand" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {settings.logoUrl && (
          <img src={settings.logoUrl} alt={settings.appName} style={{ height: 28, width: 'auto' }} />
        )}
        <span>{settings.appName}</span>
      </Link>
      <HeaderAuth />
    </header>
  );
}
