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

  hlsUrl(videoUid: string, token: string): string {
    return `https://customer-${this.config.get('CLOUDFLARE_CUSTOMER_CODE')}.cloudflarestream.com/${token}/manifest/video.m3u8`;
  }
}
