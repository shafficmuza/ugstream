'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { getAccessToken } from '@/lib/auth';
import { useAuth } from '@/lib/auth-context';
import { PosterGrid } from '@/components/poster-grid';
import { TitleCardData } from '@/components/title-card';

export default function MyListPage() {
  const { me } = useAuth();
  const [titles, setTitles] = useState<TitleCardData[] | null>(null);

  useEffect(() => {
    const token = getAccessToken();
    if (me === undefined) return; // still checking auth
    if (!me || !token) {
      setTitles([]);
      return;
    }
    apiFetch<TitleCardData[]>('/me/my-list', { token })
      .then(setTitles)
      .catch(() => setTitles([]));
  }, [me]);

  return (
    <main className="page">
      <h1 className="page-title">My List</h1>
      {me === null && (
        <p className="empty-state">
          <Link href="/login" style={{ textDecoration: 'underline' }}>
            Log in
          </Link>{' '}
          to keep a list of titles you want to watch.
        </p>
      )}
      {me && titles !== null && (
        <PosterGrid
          titles={titles}
          emptyText="Your list is empty — browse titles and tap + to add them here."
        />
      )}
    </main>
  );
}
