'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';

export function HeaderAuth() {
  const router = useRouter();
  const { me, logout } = useAuth();

  async function handleLogout() {
    await logout();
    router.push('/');
  }

  if (me === undefined) {
    // Reserve the space so the header doesn't jump once we know the answer.
    return <div style={{ width: 70 }} />;
  }

  if (!me) {
    return (
      <Link href="/login" className="btn">
        Log in
      </Link>
    );
  }

  const isStaff = me.role === 'admin' || me.role === 'editor';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      <span style={{ fontSize: 13, opacity: 0.7 }}>{me.phone}</span>
      {isStaff && (
        <Link href="/admin" style={{ fontSize: 13, textDecoration: 'underline' }}>
          {me.role === 'admin' ? 'Admin' : 'Manage'}
        </Link>
      )}
      <button className="btn" onClick={handleLogout}>
        Log out
      </button>
    </div>
  );
}
