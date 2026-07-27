'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { getAccessToken } from '@/lib/auth';
import { useAuth } from '@/lib/auth-context';
import { Rail } from './rail';

interface ContinueItem {
  episodeId: string;
  positionSecs: number;
  durationSecs: number | null;
  thumbnailUrl: string | null;
  title: { slug: string; name: string; posterUrl: string | null; kind?: string };
  season: number;
  number: number;
}

/**
 * Client-side rail: continue-watching is per-user, so it can't come from
 * the server-rendered /home payload (which is shared/unauthenticated).
 */
export function ContinueWatchingRail() {
  const { me } = useAuth();
  const [items, setItems] = useState<ContinueItem[]>([]);

  useEffect(() => {
    const token = getAccessToken();
    if (!me || !token) {
      setItems([]);
      return;
    }
    apiFetch<ContinueItem[]>('/me/continue-watching', { token })
      .then(setItems)
      .catch(() => setItems([]));
  }, [me]);

  if (items.length === 0) return null;

  return (
    <Rail heading="Continue Watching">
      {items.map((item) => (
        <Link
          key={item.episodeId}
          href={`/watch/${item.episodeId}`}
          className="card"
          title={item.title.name}
        >
          <img src={item.title.posterUrl ?? item.thumbnailUrl ?? undefined} alt={item.title.name} loading="lazy" />
          <div className="card-overlay" style={{ opacity: 1 }}>
            <div className="card-name">{item.title.name}</div>
            {/* Only series have meaningful season/episode numbers — a movie is
                stored internally as one S1 E1 episode, so don't label it. */}
            {item.title.kind === 'series' && (
              <div className="card-sub">
                S{item.season} E{item.number}
              </div>
            )}
            <div className="progress-track">
              <div
                className="progress-fill"
                style={{
                  width: `${
                    item.durationSecs
                      ? Math.min(100, Math.round((item.positionSecs / item.durationSecs) * 100))
                      : 0
                  }%`,
                }}
              />
            </div>
          </div>
        </Link>
      ))}
    </Rail>
  );
}
