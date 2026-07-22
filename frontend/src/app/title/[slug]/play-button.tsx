'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiError } from '@/lib/api';
import { getAccessToken } from '@/lib/auth';
import { VideoPlayer } from './video-player';

export function PlayButton({ episodeId, label }: { episodeId: string; label: string }) {
  const router = useRouter();
  const [playback, setPlayback] = useState<{ playbackUrl: string; resumeAt: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function play() {
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
  }

  if (playback) {
    return <VideoPlayer episodeId={episodeId} src={playback.playbackUrl} startAt={playback.resumeAt} />;
  }

  return (
    <div style={{ marginTop: 16 }}>
      <button className="btn" onClick={play}>
        {label}
      </button>
      {error && <p style={{ color: '#ff6b6b' }}>{error}</p>}
    </div>
  );
}
