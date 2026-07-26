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

export function WatchPlayer({
  episodeId,
  src,
  startAt,
  hlsToken,
  onPause,
}: {
  episodeId: string;
  src: string;
  startAt: number;
  hlsToken?: string;
  onPause?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current as FullscreenVideoElement | null;
    if (!video) return;

    // Hides the browser's native "Download" control. This is a UX nicety,
    // not real DRM — the actual protection against ripping is the signed,
    // hour-scoped Cloudflare Stream URL plus HLS segmenting (see
    // episodes.service.ts `play()`).
    video.setAttribute('controlsList', 'nodownload');
    video.setAttribute('disablePictureInPicture', 'true');
    const blockContextMenu = (e: Event) => e.preventDefault();
    video.addEventListener('contextmenu', blockContextMenu);

    // On phones/tablets, go fullscreen + landscape the moment playback
    // starts (per product requirement). On desktop the /watch page itself
    // IS the wide player (Netflix-style), so no forced fullscreen there —
    // the native controls still offer it.
    const isTouchDevice = window.matchMedia('(pointer: coarse)').matches;
    const enterImmersiveMode = () => {
      if (!isTouchDevice) return;
      if (typeof video.webkitEnterFullscreen === 'function') {
        // iOS Safari: its native fullscreen player rotates to landscape
        // for video content automatically.
        video.webkitEnterFullscreen();
        return;
      }
      video.requestFullscreen?.().then(() => {
        const orientation = screen.orientation as (ScreenOrientation & { lock?: (o: string) => Promise<void> }) | undefined;
        orientation?.lock?.('landscape').catch(() => {
          // Rejected (policy/no orientation) — fullscreen itself succeeded.
        });
      }).catch(() => {
        // Fullscreen rejected — playback continues in-page.
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
    // For self-hosted R2 HLS, every request (master, variant playlists,
    // segments) must carry the signed ?t=<token> the Worker checks. Playlists
    // use relative URLs, so we append it to every request via a custom
    // loader rather than relying on the query string propagating.
    const withToken = (url: string): string => {
      if (!hlsToken) return url;
      return url.includes('t=') ? url : `${url}${url.includes('?') ? '&' : '?'}t=${hlsToken}`;
    };

    if (Hls.isSupported()) {
      class TokenLoader extends Hls.DefaultConfig.loader {
        load(context: any, config: any, callbacks: any) {
          if (context?.url) context.url = withToken(context.url);
          super.load(context, config, callbacks);
        }
      }
      hls = new Hls(hlsToken ? { loader: TokenLoader as any } : {});
      hls.loadSource(withToken(src));
      hls.attachMedia(video);
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari/iOS play HLS natively. Native player can't rewrite segment
      // URLs, so it relies on the token propagating from the manifest URL —
      // acceptable for the Cloudflare Stream path (its own signed URLs); the
      // R2 path is primarily served through hls.js above.
      video.src = withToken(src);
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
        /* best-effort — a missed progress tick isn't worth surfacing */
      });
    };

    const interval = setInterval(reportProgress, 15_000);
    const handlePause = () => {
      reportProgress();
      onPause?.();
    };
    video.addEventListener('pause', handlePause);

    return () => {
      clearInterval(interval);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('playing', enterImmersiveMode);
      video.removeEventListener('contextmenu', blockContextMenu);
      document.removeEventListener('fullscreenchange', restoreOrientation);
      hls?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, startAt, episodeId]);

  return <video ref={videoRef} controls autoPlay playsInline />;
}
