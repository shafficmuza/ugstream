'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';

// adminOnly items are hidden from (and blocked for) editors — critical
// sections: pricing, staff/roles, financials, branding + payment settings.
const NAV = [
  { href: '/admin', label: 'Dashboard' },
  { href: '/admin/docs', label: 'Guide' },
  { href: '/admin/titles', label: 'Titles' },
  { href: '/admin/media', label: 'Uploads' },
  { href: '/admin/genres', label: 'Genres' },
  { href: '/admin/kinds', label: 'Kinds' },
  { href: '/admin/activity', label: 'Activity', adminOnly: true },
  { href: '/admin/plans', label: 'Plans', adminOnly: true },
  { href: '/admin/users', label: 'Users', adminOnly: true },
  { href: '/admin/payments', label: 'Payments', adminOnly: true },
  { href: '/admin/settings', label: 'Settings', adminOnly: true },
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

  const isStaff = me && (me.role === 'admin' || me.role === 'editor');
  const isAdmin = me?.role === 'admin';

  if (!isStaff) {
    return <main style={{ padding: 40 }}>You need a staff account to view this page.</main>;
  }

  // Editors are routed away from admin-only pages if they navigate directly.
  const onAdminOnlyPage = NAV.some(
    (n) => n.adminOnly && (n.href === '/admin' ? pathname === '/admin' : pathname?.startsWith(n.href)),
  );
  if (!isAdmin && onAdminOnlyPage) {
    return <main style={{ padding: 40 }}>This section is restricted to administrators.</main>;
  }

  const visibleNav = NAV.filter((item) => isAdmin || !item.adminOnly);

  return (
    <div className="admin-shell">
      <nav className="admin-nav">
        {visibleNav.map((item) => {
          const active = item.href === '/admin' ? pathname === '/admin' : pathname?.startsWith(item.href);
          return (
            <Link key={item.href} href={item.href} className={active ? 'admin-nav-link active' : 'admin-nav-link'}>
              {item.label}
            </Link>
          );
        })}
        {!isAdmin && (
          <span style={{ fontSize: 11, opacity: 0.5, padding: '8px 12px' }}>Editor access</span>
        )}
      </nav>
      <div className="admin-content">{children}</div>
    </div>
  );
}
