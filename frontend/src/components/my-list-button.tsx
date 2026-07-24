'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { getAccessToken } from '@/lib/auth';
import { useAuth } from '@/lib/auth-context';

export function MyListButton({ titleId }: { titleId: string }) {
  const router = useRouter();
  const { me } = useAuth();
  const [inList, setInList] = useState<boolean | null>(null);

  useEffect(() => {
    const token = getAccessToken();
    if (!me || !token) {
      setInList(false);
      return;
    }
    apiFetch<{ id: string }[]>('/me/my-list', { token })
      .then((items) => setInList(items.some((t) => t.id === titleId)))
      .catch(() => setInList(false));
  }, [me, titleId]);

  async function toggle() {
    const token = getAccessToken();
    if (!token) {
      router.push('/login');
      return;
    }
    const next = !inList;
    setInList(next); // optimistic — revert on failure
    try {
      await apiFetch(`/me/my-list/${titleId}`, { method: next ? 'POST' : 'DELETE', token });
    } catch {
      setInList(!next);
    }
  }

  return (
    <button
      className="btn-icon"
      onClick={toggle}
      aria-label={inList ? 'Remove from My List' : 'Add to My List'}
      title={inList ? 'Remove from My List' : 'Add to My List'}
    >
      {inList ? '✓' : '+'}
    </button>
  );
}
