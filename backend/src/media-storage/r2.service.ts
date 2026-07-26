import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';

/**
 * Cloudflare R2 via the S3-compatible API. R2 charges $0 egress, so it's
 * the delivery backend for the self-hosted 4K HLS path (the Contabo VPS
 * transcodes; R2 + the Cloudflare edge deliver). Credentials are optional
 * at boot — the service only throws when actually used without config, so
 * the app still runs on the Cloudflare Stream path until R2 is set up.
 */
@Injectable()
export class R2Service {
  private readonly logger = new Logger(R2Service.name);
  private _client?: S3Client;

  constructor(private readonly config: ConfigService) {}

  /** True once R2 creds are present — callers can branch on this. */
  get configured(): boolean {
    return Boolean(
      this.config.get('R2_ACCOUNT_ID') &&
        this.config.get('R2_ACCESS_KEY_ID') &&
        this.config.get('R2_SECRET_ACCESS_KEY') &&
        this.config.get('R2_BUCKET'),
    );
  }

  get bucket(): string {
    return this.must('R2_BUCKET');
  }

  /** Public host that fronts the bucket (the Cloudflare Worker domain),
   *  e.g. "cdn.ham.sentepos.com". Playback URLs are built against this. */
  get publicHost(): string {
    return this.must('R2_PUBLIC_HOST');
  }

  private must(key: string): string {
    const v = this.config.get<string>(key);
    if (!v) throw new InternalServerErrorException(`Missing config: ${key} (R2 not configured)`);
    return v;
  }

  private client(): S3Client {
    if (this._client) return this._client;
    const accountId = this.must('R2_ACCOUNT_ID');
    this._client = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: this.must('R2_ACCESS_KEY_ID'),
        secretAccessKey: this.must('R2_SECRET_ACCESS_KEY'),
      },
    });
    return this._client;
  }

  async putFile(key: string, localPath: string, contentType: string): Promise<void> {
    const { size } = await stat(localPath);
    await this.client().send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: createReadStream(localPath),
        ContentLength: size,
        ContentType: contentType,
      }),
    );
  }

  /** Deletes every object under a prefix (an episode's whole HLS tree). */
  async deletePrefix(prefix: string): Promise<number> {
    let removed = 0;
    let token: string | undefined;
    do {
      const listed = await this.client().send(
        new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token }),
      );
      const objects = (listed.Contents ?? []).map((o) => ({ Key: o.Key! }));
      if (objects.length) {
        await this.client().send(
          new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: objects } }),
        );
        removed += objects.length;
      }
      token = listed.IsTruncated ? listed.NextContinuationToken : undefined;
    } while (token);
    return removed;
  }
}
