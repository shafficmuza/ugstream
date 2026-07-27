'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';

const NAV = [
  { href: '/admin', label: 'Dashboard' },
  { href: '/admin/docs', label: 'Guide' },
  { href: '/admin/titles', label: 'Titles' },
  { href: '/admin/genres', label: 'Genres' },
  { href: '/admin/kinds', label: 'Kinds' },
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
    <div className="admin-shell">
      <nav className="admin-nav">
        {NAV.map((item) => {
          const active = item.href === '/admin' ? pathname === '/admin' : pathname?.startsWith(item.href);
          return (
            <Link key={item.href} href={item.href} className={active ? 'admin-nav-link active' : 'admin-nav-link'}>
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="admin-content">{children}</div>
    </div>
  );
}
