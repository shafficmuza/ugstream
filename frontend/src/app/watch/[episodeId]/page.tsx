'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { apiFetch, ApiError } from '@/lib/api';
import { getAccessToken } from '@/lib/auth';
import { WatchPlayer } from './watch-player';

interface PlaybackInfo {
  playbackUrl: string;
  resumeAt: number;
  provider?: 'cloudflare' | 'r2_hls';
  hlsToken?: string;
  title?: { name: string; slug: string; kind: string };
  episode?: { season: number; number: number; name: string | null };
}

/**
 * Netflix-style watch page: the whole viewport is the player
 * (/watch/:episodeId), with a back arrow + title that fade out while
 * watching and reappear on mouse movement or pause.
 */
export default function WatchPage() {
  const params = useParams<{ episodeId: string }>();
  const router = useRouter();
  const [playback, setPlayback] = useState<PlaybackInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chromeVisible, setChromeVisible] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      router.replace('/login');
      return;
    }
    apiFetch<PlaybackInfo>(`/episodes/${params.episodeId}/play`, { method: 'POST', token })
      .then(setPlayback)
      .catch((e) => {
        const err = e as ApiError;
        if (err.statusCode === 402) {
          router.replace(`/account/subscribe?episodeId=${params.episodeId}`);
        } else if (err.statusCode === 401) {
          router.replace('/login');
        } else {
          setError(err.message ?? 'Could not start playback.');
        }
      });
  }, [params.episodeId, router]);

  const showChrome = useCallback(() => {
    setChromeVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setChromeVisible(false), 3000);
  }, []);

  useEffect(() => {
    showChrome();
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [showChrome]);

  function goBack() {
    if (playback?.title?.slug) {
      router.push(`/title/${playback.title.slug}`);
    } else {
      router.back();
    }
  }

  const episodeLabel =
    playback?.title?.kind === 'series' && playback.episode
      ? `S${playback.episode.season} E${playback.episode.number}${
          playback.episode.name ? ` · ${playback.episode.name}` : ''
        }`
      : null;

  return (
    <div className="watch-page" onMouseMove={showChrome} onTouchStart={showChrome}>
      {playback ? (
        <WatchPlayer
          episodeId={params.episodeId}
          src={playback.playbackUrl}
          startAt={playback.resumeAt}
          hlsToken={playback.hlsToken}
          onPause={showChrome}
        />
      ) : (
        <div className="watch-center">
          {error ? (
            <>
              <p style={{ color: '#ff6b6b', marginBottom: 16 }}>{error}</p>
              <button className="btn" onClick={goBack}>
                Go back
              </button>
            </>
          ) : (
            <div className="watch-spinner" aria-label="Loading" />
          )}
        </div>
      )}

      <div className={chromeVisible ? 'watch-chrome visible' : 'watch-chrome'}>
        <button className="watch-back" onClick={goBack} aria-label="Back">
          ←
        </button>
        {playback?.title && (
          <div className="watch-info">
            <div className="watch-title">{playback.title.name}</div>
            {episodeLabel && <div className="watch-episode">{episodeLabel}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
