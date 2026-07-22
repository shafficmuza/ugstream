'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';

const NAV = [
  { href: '/admin', label: 'Dashboard' },
  { href: '/admin/titles', label: 'Titles' },
  { href: '/admin/genres', label: 'Genres' },
  { href: '/admin/plans', label: 'Plans' },
  { href: '/admin/users', label: 'Users' },
  { href: '/admin/payments', label: 'Payments' },
  { href: '/admin/settings', label: 'Settings' },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { me } = useAuth();

  useEffect(() => {
    if (me === null) router.push('/login');
  }, [me, router]);

  if (me === undefined) {
    return <main style={{ padding: 40 }}>Checking access…</main>;
  }

  if (!me || me.role !== 'admin') {
    return <main style={{ padding: 40 }}>You need an admin account to view this page.</main>;
  }

  return (
    <div style={{ display: 'flex', minHeight: 'calc(100vh - 61px)' }}>
      <nav
        style={{
          width: 180,
          flexShrink: 0,
          borderRight: '1px solid #222',
          padding: '20px 0',
        }}
      >
        {NAV.map((item) => {
          const active = item.href === '/admin' ? pathname === '/admin' : pathname?.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              style={{
                display: 'block',
                padding: '10px 20px',
                fontSize: 14,
                background: active ? '#1c1c22' : 'transparent',
                borderLeft: active ? '3px solid #e6363f' : '3px solid transparent',
                opacity: active ? 1 : 0.75,
              }}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div style={{ flex: 1, padding: '30px 40px' }}>{children}</div>
    </div>
  );
}
