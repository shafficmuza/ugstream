import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Thin wrapper around the Cloudflare Stream API. Docs:
 * https://developers.cloudflare.com/stream/uploading-videos/direct-creator-uploads/
 * https://developers.cloudflare.com/stream/viewing-videos/securing-your-stream-embeds/
 */
@Injectable()
export class CloudflareStreamService {
  constructor(private readonly config: ConfigService) {}

  private get accountId(): string {
    return this.mustGet('CLOUDFLARE_ACCOUNT_ID');
  }

  private get apiToken(): string {
    return this.mustGet('CLOUDFLARE_STREAM_API_TOKEN');
  }

  private mustGet(key: string): string {
    const value = this.config.get<string>(key);
    if (!value) throw new InternalServerErrorException(`Missing config: ${key}`);
    return value;
  }

  /**
   * Requests a one-time upload URL. The admin's browser then PUTs the video
   * file directly to Cloudflare — the file never touches our server.
   */
  async createDirectUpload(): Promise<{ uploadUrl: string; videoUid: string }> {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/stream/direct_upload`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          maxDurationSeconds: 4 * 60 * 60,
          requireSignedURLs: true,
          // Abandoned placeholders (admin clicked "Add video" but never
          // uploaded, or the upload failed) previously lingered as
          // "pending" videos in the Cloudflare dashboard indefinitely.
          // With an expiry Cloudflare purges them itself.
          expiry: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
        }),
      },
    );

    const json = await res.json();
    if (!json.success) {
      throw new InternalServerErrorException(
        `Cloudflare direct_upload failed: ${JSON.stringify(json.errors)}`,
      );
    }

    return { uploadUrl: json.result.uploadURL, videoUid: json.result.uid };
  }

  /**
   * Create a resumable (TUS) upload and return the tus endpoint URL the
   * browser will PATCH chunks to. This is the ONLY viable path for large
   * files: the plain direct_upload POST caps at ~200MB, so a 2GB movie
   * fails every time on it. TUS uploads in chunks (resumable) up to 30GB.
   * The API token stays server-side — Cloudflare pre-creates the upload
   * here and hands back a URL that needs no auth to PATCH to.
   */
  async createTusUpload(
    uploadLength: number,
    name: string,
  ): Promise<{ uploadUrl: string; videoUid: string }> {
    const meta = [
      `name ${Buffer.from(name).toString('base64')}`,
      'requiresignedurls',
    ].join(',');
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/stream?direct_user=true`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          'Tus-Resumable': '1.0.0',
          'Upload-Length': String(uploadLength),
          'Upload-Metadata': meta,
        },
      },
    );
    if (res.status !== 201) {
      throw new InternalServerErrorException(
        `Cloudflare tus create failed: ${res.status} ${await res.text()}`,
      );
    }
    const uploadUrl = res.headers.get('Location');
    const videoUid = res.headers.get('stream-media-id');
    if (!uploadUrl || !videoUid) {
      throw new InternalServerErrorException('Cloudflare tus create returned no upload URL.');
    }
    return { uploadUrl, videoUid };
  }

  /** All videos in the Stream account (uid + state), for reconciliation. */
  async listVideos(): Promise<{ uid: string; state: string }[]> {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/stream?per_page=1000`,
      { headers: { Authorization: `Bearer ${this.apiToken}` } },
    );
    const json = await res.json();
    if (!json.success) {
      throw new InternalServerErrorException(`Cloudflare list failed: ${JSON.stringify(json.errors)}`);
    }
    return json.result.map((v: any) => ({ uid: v.uid, state: v.status?.state }));
  }

  /**
   * Best-effort delete — used when re-pointing an episode at a fresh
   * upload so the superseded video doesn't linger in the dashboard.
   * A 404 (placeholder already expired/purged) is success, not an error.
   */
  async deleteVideo(videoUid: string): Promise<void> {
    await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/stream/${videoUid}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${this.apiToken}` } },
    ).catch(() => undefined);
  }

  /**
   * Server-side URL ingest (`/stream/copy`) — Cloudflare downloads the
   * file itself, bypassing the ~200MB browser direct-upload limit. The
   * only workable path for large files.
   */
  async copyFromUrl(url: string, name: string): Promise<{ videoUid: string }> {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/stream/copy`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url, meta: { name }, requireSignedURLs: true }),
      },
    );
    const json = await res.json();
    if (!json.success) {
      throw new InternalServerErrorException(
        `Cloudflare URL ingest failed: ${JSON.stringify(json.errors)}`,
      );
    }
    return { videoUid: json.result.uid };
  }

  /**
   * Short-lived signed token scoped to one video, via Cloudflare's own
   * token-issuing endpoint rather than hand-rolled JWT signing — Cloudflare
   * requires `kid` in the payload too (not just the header) and `exp`/`nbf`
   * as strings, which a manually-built JWT got wrong and Cloudflare
   * rejected with a silent 401 on the manifest URL. Letting Cloudflare
   * issue the token sidesteps needing our own signing key entirely.
   */
  async signPlaybackToken(videoUid: string, expiresInSeconds = 3600): Promise<string> {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/stream/${videoUid}/token`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ exp: Math.floor(Date.now() / 1000) + expiresInSeconds }),
      },
    );

    const json = await res.json();
    if (!json.success) {
      throw new InternalServerErrorException(
        `Cloudflare token generation failed: ${JSON.stringify(json.errors)}`,
      );
    }
    return json.result.token;
  }

  /**
   * A still from the video, at an optional timestamp.
   *
   * Takes the signed token in place of the uid for exactly the same reason the
   * manifest does: these videos are created with requireSignedURLs, which
   * covers thumbnails too. The unsigned form Cloudflare reports in its API
   * response answers 401, so storing that — which is what we were doing —
   * leaves every episode still a broken image.
   */
  thumbnailUrl(token: string, opts: { timeSecs?: number; height?: number } = {}): string {
    const params = new URLSearchParams();
    if (opts.timeSecs != null) params.set('time', `${Math.max(0, Math.round(opts.timeSecs))}s`);
    params.set('height', String(opts.height ?? 360));
    return `https://customer-${this.config.get('CLOUDFLARE_CUSTOMER_CODE')}.cloudflarestream.com/${token}/thumbnails/thumbnail.jpg?${params}`;
  }

  /**
   * Make a chosen moment the video's own default still, as a fraction of its
   * runtime. Stored on Cloudflare, so every later thumbnail request gets that
   * frame without us having to pass a timestamp or remember one.
   */
  /**
   * Rename a video on Cloudflare's side. Only cosmetic to playback, but it is
   * what the Stream dashboard lists, so it decides whether the library can be
   * searched or reconciled against our own records at all.
   */
  async setVideoName(videoUid: string, name: string): Promise<void> {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/stream/${videoUid}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ meta: { name } }),
      },
    );
    const json = await res.json().catch(() => null);
    if (!json?.success) {
      throw new InternalServerErrorException(
        `Cloudflare rename failed: ${JSON.stringify(json?.errors ?? res.status)}`,
      );
    }
  }

  async setThumbnailTimestampPct(videoUid: string, pct: number): Promise<void> {
    const clamped = Math.min(1, Math.max(0, pct));
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/stream/${videoUid}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ thumbnailTimestampPct: clamped }),
      },
    );
    const json = await res.json().catch(() => null);
    if (!json?.success) {
      throw new InternalServerErrorException(
        `Cloudflare thumbnail timestamp failed: ${JSON.stringify(json?.errors ?? res.status)}`,
      );
    }
  }

  hlsUrl(videoUid: string, token: string): string {
    return `https://customer-${this.config.get('CLOUDFLARE_CUSTOMER_CODE')}.cloudflarestream.com/${token}/manifest/video.m3u8`;
  }

  /**
   * Direct status check, independent of the "ready"/"error" webhook — one
   * video (2026-07-22, Elephants Dream) finished transcoding on
   * Cloudflare's side but the webhook never fired, so our own record sat
   * `uploading` indefinitely even though it was actually playable. Lets
   * EpisodesService self-heal on read (admin viewing the title, or a user
   * hitting play) rather than depending on the webhook alone ever arriving
   * — same pattern as the Stripe/MoMo payment self-heal.
   */
  async getVideoStatus(videoUid: string): Promise<{
    ready: boolean;
    errored: boolean;
    /** The video no longer exists on Cloudflare (expired placeholder, or deleted). */
    missing: boolean;
    /** Raw Cloudflare state, e.g. 'pendingupload' | 'downloading' | 'queued' | 'inprogress' | 'ready' | 'error'. */
    state: string;
    /** When the video record was created on Cloudflare — lets callers age out dead uploads. */
    createdAt: Date | null;
    durationSecs: number;
    thumbnailUrl: string;
  }> {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/stream/${videoUid}`,
      { headers: { Authorization: `Bearer ${this.apiToken}` } },
    );
    const json = await res.json();
    if (!json.success) {
      // A 404 is a real answer (the placeholder expired or the video was
      // deleted), not a lookup failure — callers reclaim the episode slot.
      if (res.status === 404) {
        return {
          ready: false,
          errored: false,
          missing: true,
          state: 'missing',
          createdAt: null,
          durationSecs: 0,
          thumbnailUrl: '',
        };
      }
      throw new InternalServerErrorException(`Cloudflare video lookup failed: ${JSON.stringify(json.errors)}`);
    }
    const result = json.result;
    return {
      ready: result.readyToStream === true || result.status?.state === 'ready',
      errored: result.status?.state === 'error',
      missing: false,
      state: result.status?.state ?? 'unknown',
      createdAt: result.created ? new Date(result.created) : null,
      durationSecs: Math.round(result.duration ?? 0),
      thumbnailUrl: result.thumbnail ?? '',
    };
  }
}
