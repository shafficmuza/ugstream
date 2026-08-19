import { useEffect, useRef, useState } from 'react';
import { apiFetch } from './api';
import { getAccessToken } from './auth';

export interface LiveDisk {
  path: string;
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
  usedPct: number;
  unavailable?: boolean;
}

export interface LiveStream {
  userId: string;
  who: string;
  phone: string | null;
  title: string;
  episode: string | null;
  device: string | null;
  startedAt: string;
  lastSeenAt: string;
  watchingForSecs: number;
}

export interface LiveDevice {
  sessionId: string;
  who: string;
  device: string | null;
  lastSeenAt: string;
  idleSecs: number;
}

export interface Live {
  at: string;
  disk: LiveDisk;
  watching: { count: number; viewers: number; streams: LiveStream[] };
  sessions: {
    signedIn: number;
    onlineNow: number;
    onlineWindowSecs: number;
    devices: LiveDevice[];
    byPlatform: Record<string, number>;
  };
}

/**
 * Poll /admin/live.
 *
 * Polling rather than a socket: the dashboard is a screen someone leaves open
 * all day, and a persistent connection per open tab is a failure mode this box
 * does not need. Nothing here changes faster than a person can read it.
 *
 * The timer is cleared while the tab is hidden — a forgotten dashboard should
 * not keep querying the database overnight — and a poll is skipped while one
 * is already in flight, so a slow response cannot stack requests up behind it.
 */
export function useLive(pollMs = 5000) {
  const [live, setLive] = useState<Live | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    async function tick() {
      if (inFlight.current || document.hidden) return;
      const token = getAccessToken();
      if (!token) return;
      inFlight.current = true;
      try {
        const data = await apiFetch<Live>('/admin/live', { token });
        if (!stopped) {
          setLive(data);
          setError(null);
        }
      } catch (e: any) {
        // Keep the last good numbers on screen rather than blanking the panel:
        // a momentary failure should read as "stale", not as "nobody online".
        if (!stopped) setError(e?.message ?? 'Could not refresh.');
      } finally {
        inFlight.current = false;
      }
    }

    const start = () => {
      if (timer) return;
      tick();
      timer = setInterval(tick, pollMs);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => (document.hidden ? stop() : start());

    start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stopped = true;
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [pollMs]);

  return { live, error };
}

export function humanBytes(b: number): string {
  if (b >= 1e12) return `${(b / 1e12).toFixed(2)} TB`;
  if (b >= 1e9) return `${(b / 1e9).toFixed(1)} GB`;
  if (b >= 1e6) return `${(b / 1e6).toFixed(0)} MB`;
  return `${(b / 1e3).toFixed(0)} KB`;
}

export function humanDuration(secs: number): string {
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
