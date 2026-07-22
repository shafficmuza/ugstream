'use client';

import { useEffect, useRef } from 'react';
import Hls from 'hls.js';
import { apiFetch } from '@/lib/api';
import { getAccessToken } from '@/lib/auth';

// Not typed on HTMLVideoElement/its React props by default in this TS/React
// version, and Safari-only APIs — declared here rather than reaching for `any`
// at every call site.
interface FullscreenVideoElement extends HTMLVideoElement {
  webkitEnterFullscreen?: () => void;
}

export function VideoPlayer({
  episodeId,
  src,
  startAt,
}: {
  episodeId: string;
  src: string;
  startAt: number;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current as FullscreenVideoElement | null;
    if (!video) return;

    // Hides the browser's native "Download" control. This is a UX nicety,
    // not real DRM — the actual protection against ripping is the signed,
    // hour-scoped Cloudflare Stream URL plus HLS segmenting (see
    // episodes.service.ts `play()`), which already stops a plain
    // "right click > Save Video As" on a raw file the way an <video src=
    // mp4> would allow.
    video.setAttribute('controlsList', 'nodownload');
    video.setAttribute('disablePictureInPicture', 'true');
    const blockContextMenu = (e: Event) => e.preventDefault();
    video.addEventListener('contextmenu', blockContextMenu);

    // Netflix-style: fullscreen + landscape the moment playback starts,
    // triggered by the 'playing' event so it stays inside the gesture
    // chain that started with the user's Play click.
    const enterImmersiveMode = () => {
      if (typeof video.webkitEnterFullscreen === 'function') {
        // iOS Safari: its native fullscreen player rotates to landscape
        // for video content automatically — no separate orientation call
        // exists (or is needed) on iOS.
        video.webkitEnterFullscreen();
        return;
      }
      video.requestFullscreen?.().then(() => {
        const orientation = screen.orientation as (ScreenOrientation & { lock?: (o: string) => Promise<void> }) | undefined;
        orientation?.lock?.('landscape').catch(() => {
          // Desktop browsers and some mobile browsers reject this outright
          // (no orientation to lock, or user/browser policy) — fullscreen
          // itself still succeeded, so just proceed without forcing it.
        });
      }).catch(() => {
        // Fullscreen request rejected (e.g. browser policy) — playback
        // continues normally, just not fullscreen.
      });
    };
    video.addEventListener('playing', enterImmersiveMode, { once: true });

    const restoreOrientation = () => {
      if (!document.fullscreenElement) {
        const orientation = screen.orientation as (ScreenOrientation & { unlock?: () => void }) | undefined;
        orientation?.unlock?.();
      }
    };
    document.addEventListener('fullscreenchange', restoreOrientation);

    let hls: Hls | undefined;
    if (Hls.isSupported()) {
      hls = new Hls();
      hls.loadSource(src);
      hls.attachMedia(video);
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari/iOS play HLS natively.
      video.src = src;
    }

    video.currentTime = startAt;

    const reportProgress = () => {
      const token = getAccessToken();
      if (!token || video.paused) return;
      apiFetch(`/episodes/${episodeId}/progress`, {
        method: 'PUT',
        token,
        body: { positionSecs: Math.floor(video.currentTime) },
      }).catch(() => {
        /* best-effort — a missed progress tick isn't worth surfacing to the viewer */
      });
    };

    const interval = setInterval(reportProgress, 15_000);
    video.addEventListener('pause', reportProgress);

    return () => {
      clearInterval(interval);
      video.removeEventListener('pause', reportProgress);
      video.removeEventListener('playing', enterImmersiveMode);
      video.removeEventListener('contextmenu', blockContextMenu);
      document.removeEventListener('fullscreenchange', restoreOrientation);
      hls?.destroy();
    };
  }, [src, startAt, episodeId]);

  return (
    <video
      ref={videoRef}
      controls
      autoPlay
      playsInline
      style={{ width: '100%', maxWidth: 900, marginTop: 16, borderRadius: 6, background: 'black' }}
    />
  );
}
