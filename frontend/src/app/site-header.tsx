'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { AppSettings } from '@/lib/settings';
import { HeaderAuth } from './header-auth';
import { SearchBox } from '@/components/search-box';

const NAV = [
  { href: '/', label: 'Home' },
  { href: '/movies', label: 'Movies' },
  { href: '/series', label: 'Series' },
  { href: '/kids', label: 'Kids' },
  { href: '/my-list', label: 'My List' },
];

export function SiteHeader({ settings }: { settings: AppSettings }) {
  const pathname = usePathname();
  const [solid, setSolid] = useState(false);

  useEffect(() => {
    const onScroll = () => setSolid(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header className={solid ? 'nf-header solid' : 'nf-header'}>
      <Link href="/" className="brand">
        {settings.logoUrl && (
          <img src={settings.logoUrl} alt={settings.appName} style={{ height: 28, width: 'auto' }} />
        )}
        <span>{settings.appName}</span>
      </Link>

      <nav className="nf-nav">
        {NAV.map((item) => {
          const active = item.href === '/' ? pathname === '/' : pathname?.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={active ? 'nf-nav-link active' : 'nf-nav-link'}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="nf-header-right">
        <Suspense fallback={<div style={{ width: 36 }} />}>
          <SearchBox />
        </Suspense>
        <HeaderAuth />
      </div>
    </header>
  );
}
