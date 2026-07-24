'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiError } from '@/lib/api';
import { getAccessToken } from '@/lib/auth';
import { VideoPlayer } from './video-player';

export function PlayButton({
  episodeId,
  label,
  autoPlay = false,
  className = 'btn-play',
}: {
  episodeId: string;
  label: string;
  autoPlay?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const [playback, setPlayback] = useState<{ playbackUrl: string; resumeAt: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const play = useCallback(async () => {
    const token = getAccessToken();
    if (!token) {
      router.push('/login');
      return;
    }

    try {
      const res = await apiFetch<{ playbackUrl: string; resumeAt: number }>(
        `/episodes/${episodeId}/play`,
        { method: 'POST', token },
      );
      setPlayback(res);
    } catch (e) {
      const err = e as ApiError;
      if (err.statusCode === 402) {
        // Not entitled — send to the subscribe/purchase flow.
        router.push(`/account/subscribe?episodeId=${episodeId}`);
        return;
      }
      setError(err.message ?? 'Could not start playback.');
    }
  }, [episodeId, router]);

  // Billboard "Play" lands here as /title/slug?play=1 — start immediately
  // instead of making the user click Play a second time.
  useEffect(() => {
    if (autoPlay) play();
  }, [autoPlay, play]);

  if (playback) {
    return <VideoPlayer episodeId={episodeId} src={playback.playbackUrl} startAt={playback.resumeAt} />;
  }

  return (
    <>
      <button className={className} onClick={play}>
        <span aria-hidden>▶</span> {label}
      </button>
      {error && <p style={{ color: '#ff6b6b', width: '100%' }}>{error}</p>}
    </>
  );
}
