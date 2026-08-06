import { HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { Episode } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EntitlementsService } from '../common/entitlements.service';
import { CloudflareStreamService } from './cloudflare-stream.service';
import { R2Service } from '../media-storage/r2.service';
import { TranscodeService } from './transcode.service';
import { StreamLeaseService } from '../playback/stream-lease.service';

@Injectable()
export class EpisodesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementsService,
    private readonly stream: CloudflareStreamService,
    private readonly r2: R2Service,
    private readonly transcode: TranscodeService,
    private readonly leases: StreamLeaseService,
    private readonly config: ConfigService,
  ) {}

  async play(userId: bigint, episodeId: bigint, sessionId?: string, deviceLabel?: string | null) {
    let episode = await this.prisma.episode.findUnique({ where: { id: episodeId } });
    if (!episode) throw new NotFoundException('Episode not found.');

    if (episode.videoProvider === 'r2_hls' || episode.videoProvider === 'r2_file') {
      // Self-hosted on R2 (HLS ladder, or a single ready-made file). Both
      // store their object key/prefix in r2Prefix and set cfStatus directly
      // — no Cloudflare status to sync.
      if (episode.cfStatus !== 'ready' || !episode.r2Prefix) {
        throw new NotFoundException('Video is not ready for playback yet.');
      }
    } else {
      // Cloudflare Stream: self-heal a stuck status, then require the uid.
      episode = await this.syncStatus(episode);
      if (episode.cfStatus !== 'ready' || !episode.cfVideoUid) {
        throw new NotFoundException('Video is not ready for playback yet.');
      }
    }

    const result = await this.entitlements.check(userId, episode.titleId);
    if (!result.entitled) {
      const plans = await this.prisma.plan.findMany({ where: { active: true } });
      const title = await this.prisma.title.findUniqueOrThrow({ where: { id: episode.titleId } });
      // ForbiddenException hardcodes HTTP 403 regardless of body content —
      // use the base HttpException so the response is actually a 402, as
      // the frontend's ApiError.statusCode check expects.
      throw new HttpException(
        {
          error: 'Payment Required',
          reason: 'not_entitled',
          options: {
            canSubscribe: title.access !== 'purchase',
            canPurchase: title.access !== 'subscription',
            priceUgx: title.priceUgx,
            plans,
          },
        },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }

    // Claim a concurrent-stream slot, after entitlement so a user who cannot
    // watch this at all is told that rather than being sent to stop another
    // device first. Throws 409 when the account is already at its limit.
    if (sessionId) {
      await this.leases.acquire(userId, sessionId, episodeId, deviceLabel);
    }

    const [history, title] = await Promise.all([
      this.prisma.watchHistory.findUnique({
        where: { userId_episodeId: { userId, episodeId } },
      }),
      this.prisma.title.findUniqueOrThrow({ where: { id: episode.titleId } }),
    ]);

    const meta = {
      resumeAt: history?.positionSecs ?? 0,
      // Metadata for the /watch page chrome (back-arrow target + overlay).
      title: { name: title.name, slug: title.slug, kind: title.kind },
      episode: { season: episode.season, number: episode.number, name: episode.name },
    };

    if (episode.videoProvider === 'r2_hls' || episode.videoProvider === 'r2_file') {
      // Self-hosted on R2, served from the bucket's public (r2.dev) URL — no
      // Worker, no per-request cost. Playback is unauthenticated at the CDN
      // layer (weaker protection, chosen deliberately for now); the app still
      // gates the *link* behind entitlement + login above. To re-add signed
      // protection later, deploy infra/r2-hls-worker and mint an hls token
      // here (see signHlsToken / git history).
      //
      // r2_hls: r2Prefix is a folder, master.m3u8 lives inside it (adaptive).
      // r2_file: r2Prefix is a single object key (a ready-made 4K MP4).
      const isHls = episode.videoProvider === 'r2_hls';
      return {
        provider: episode.videoProvider as 'r2_hls' | 'r2_file',
        playbackUrl: this.r2.publicUrl(isHls ? `${episode.r2Prefix}master.m3u8` : episode.r2Prefix!),
        expiresIn: 3600,
        ...meta,
      };
    }

    const token = await this.stream.signPlaybackToken(episode.cfVideoUid!);
    return {
      provider: 'cloudflare' as const,
      playbackUrl: this.stream.hlsUrl(episode.cfVideoUid!, token),
      expiresIn: 3600,
      ...meta,
    };
  }

  /**
   * Kick off a self-hosted 4K transcode for a title from a source URL:
   * creates an r2_hls episode and starts the ffmpeg ladder → R2 upload in
   * the background. The alternative to Cloudflare Stream when true 4K is
   * wanted (Stream caps at 1080p).
   */
  async transcode4k(titleId: bigint, sourceUrl: string, dto: { season?: number; number?: number; name?: string }) {
    if (!this.r2.configured) {
      throw new HttpException(
        'R2 is not configured — set R2_* env vars first.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    const episode = await this.prisma.episode.create({
      data: {
        titleId,
        ...(await this.nextSlot(titleId, dto.season, dto.number)),
        name: dto.name,
        videoProvider: 'r2_hls',
        cfStatus: 'uploading',
      },
    });
    this.transcode.startTranscode(episode.id, sourceUrl);
    return { ...episode, id: episode.id.toString(), titleId: episode.titleId.toString() };
  }

  private requireR2(): void {
    if (!this.r2.configured) {
      throw new HttpException('R2 is not configured — set R2_* env vars first.', HttpStatus.SERVICE_UNAVAILABLE);
    }
  }

  /** Turn a user filename into a safe object-key segment. */
  private safeName(filename: string): string {
    const base = (filename || 'video').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').slice(-80);
    return base || 'video';
  }

  /**
   * Start a browser-direct multipart upload to R2. `purpose` decides where
   * the object lands: 'source' = a temporary transcode input (deleted after),
   * 'final' = a ready-made file served as-is. Returns the key + uploadId the
   * client threads through sign-part and complete.
   */
  async r2MultipartCreate(filename: string, contentType: string, purpose: 'source' | 'final') {
    this.requireR2();
    const folder = purpose === 'source' ? 'sources' : 'files';
    const key = `${folder}/${randomUUID()}-${this.safeName(filename)}`;
    const uploadId = await this.r2.createMultipart(key, contentType || 'application/octet-stream');
    return { key, uploadId };
  }

  async r2MultipartSignPart(key: string, uploadId: string, partNumber: number) {
    this.requireR2();
    const url = await this.r2.presignUploadPart(key, uploadId, partNumber);
    return { url };
  }

  async r2MultipartComplete(key: string, uploadId: string, parts: { PartNumber: number; ETag: string }[]) {
    this.requireR2();
    await this.r2.completeMultipart(key, uploadId, parts);
    return { ok: true, key, publicUrl: this.r2.publicUrl(key) };
  }

  async r2MultipartAbort(key: string, uploadId: string) {
    this.requireR2();
    await this.r2.abortMultipart(key, uploadId);
    return { ok: true };
  }

  /**
   * Register an already-uploaded 4K file (a 'final' multipart upload) as a
   * ready episode served directly from R2 — no transcode. Fast path: the
   * admin uploads a browser-playable H.264 MP4 and it's immediately live
   * (single quality, no adaptive ladder).
   */
  async registerR2File(
    titleId: bigint,
    key: string,
    dto: { season?: number; number?: number; name?: string },
  ) {
    this.requireR2();
    if (!key) throw new HttpException('Missing uploaded file key.', HttpStatus.BAD_REQUEST);
    const episode = await this.prisma.episode.create({
      data: {
        titleId,
        ...(await this.nextSlot(titleId, dto.season, dto.number)),
        name: dto.name,
        videoProvider: 'r2_file',
        r2Prefix: key,
        cfStatus: 'ready',
      },
    });
    return { ...episode, id: episode.id.toString(), titleId: episode.titleId.toString() };
  }

  /**
   * Transcode a source that was just uploaded to R2 (a 'source' multipart
   * upload) into a 4K HLS ladder. Reads the source from its R2 public URL and
   * deletes it once the ladder is built.
   */
  async transcode4kFromR2(titleId: bigint, key: string, dto: { season?: number; number?: number; name?: string }) {
    this.requireR2();
    if (!key) throw new HttpException('Missing uploaded source key.', HttpStatus.BAD_REQUEST);
    const episode = await this.prisma.episode.create({
      data: {
        titleId,
        ...(await this.nextSlot(titleId, dto.season, dto.number)),
        name: dto.name,
        videoProvider: 'r2_hls',
        cfStatus: 'uploading',
      },
    });
    this.transcode.startTranscode(episode.id, this.r2.publicUrl(key), key);
    return { ...episode, id: episode.id.toString(), titleId: episode.titleId.toString() };
  }

  // --- Pre-made HLS ladder upload (admin encodes locally, uploads folder) --

  private static readonly HLS_PREFIX_RE = /^hls\/[a-zA-Z0-9._-]+\/$/;

  private validateHlsPrefix(prefix: string): void {
    if (!EpisodesService.HLS_PREFIX_RE.test(prefix)) {
      throw new HttpException('Invalid upload prefix.', HttpStatus.BAD_REQUEST);
    }
  }

  private assertSafeRelPath(path: string): void {
    if (!path || path.startsWith('/') || path.includes('..') || !/^[a-zA-Z0-9._/-]+$/.test(path)) {
      throw new HttpException(`Unsafe file path in ladder: ${path}`, HttpStatus.BAD_REQUEST);
    }
  }

  private hlsContentType(path: string): string {
    const p = path.toLowerCase();
    if (p.endsWith('.m3u8')) return 'application/vnd.apple.mpegurl';
    if (p.endsWith('.ts')) return 'video/mp2t';
    if (p.endsWith('.m4s') || p.endsWith('.mp4')) return 'video/mp4';
    if (p.endsWith('.vtt')) return 'text/vtt';
    return 'application/octet-stream';
  }

  /** Mint a fresh R2 prefix for one ladder upload. */
  hlsBegin() {
    this.requireR2();
    return { prefix: `hls/pre-${randomUUID()}/` };
  }

  /** Presign a PUT for every file in the ladder (browser uploads them direct). */
  async signHlsBatch(prefix: string, files: { path: string }[]) {
    this.requireR2();
    this.validateHlsPrefix(prefix);
    if (!Array.isArray(files) || files.length === 0) {
      throw new HttpException('No files to sign.', HttpStatus.BAD_REQUEST);
    }
    return Promise.all(
      files.map(async (f) => {
        this.assertSafeRelPath(f.path);
        const contentType = this.hlsContentType(f.path);
        const url = await this.r2.presignPut(`${prefix}${f.path}`, contentType);
        return { path: f.path, url, contentType };
      }),
    );
  }

  /**
   * Register an uploaded ladder as a ready adaptive episode. Confirms
   * master.m3u8 actually landed, then derives duration from the playlist
   * (summing EXTINF — no segment downloads).
   */
  async registerR2Hls(titleId: bigint, prefix: string, dto: { season?: number; number?: number; name?: string }) {
    this.requireR2();
    this.validateHlsPrefix(prefix);
    const masterKey = `${prefix}master.m3u8`;
    if (!(await this.r2.exists(masterKey))) {
      throw new HttpException(
        'master.m3u8 was not found in the uploaded folder. Your ladder must contain a master playlist named master.m3u8.',
        HttpStatus.BAD_REQUEST,
      );
    }
    const durationSecs = await this.probeHlsDuration(this.r2.publicUrl(masterKey)).catch(() => null);
    const episode = await this.prisma.episode.create({
      data: {
        titleId,
        ...(await this.nextSlot(titleId, dto.season, dto.number)),
        name: dto.name,
        videoProvider: 'r2_hls',
        r2Prefix: prefix,
        cfStatus: 'ready',
        durationSecs: durationSecs ? Math.round(durationSecs) : null,
      },
    });
    return { ...episode, id: episode.id.toString(), titleId: episode.titleId.toString() };
  }

  /** Sum EXTINF durations from the first variant playlist (no segment fetches). */
  private async probeHlsDuration(masterUrl: string): Promise<number | null> {
    const master = await (await fetch(masterUrl)).text();
    const lines = master.split('\n').map((l) => l.trim());
    let variant: string | undefined;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('#EXT-X-STREAM-INF')) {
        for (let j = i + 1; j < lines.length; j++) {
          if (lines[j] && !lines[j].startsWith('#')) {
            variant = lines[j];
            break;
          }
        }
        break;
      }
    }
    if (!variant) return null;
    const variantText = await (await fetch(new URL(variant, masterUrl).toString())).text();
    let total = 0;
    for (const l of variantText.split('\n')) {
      const m = l.match(/^#EXTINF:([0-9.]+)/);
      if (m) total += parseFloat(m[1]);
    }
    return total || null;
  }

  async saveProgress(
    userId: bigint,
    episodeId: bigint,
    positionSecs: number,
    sessionId?: string,
  ) {
    const episode = await this.prisma.episode.findUnique({ where: { id: episodeId } });
    if (!episode) throw new NotFoundException('Episode not found.');

    // Doubles as the stream-lease heartbeat: both players already send this
    // every 15s, so the limit needs no separate polling loop of its own.
    if (sessionId) await this.leases.touch(sessionId, episodeId);

    const completed = episode.durationSecs
      ? positionSecs >= episode.durationSecs * 0.92
      : false;

    await this.prisma.watchHistory.upsert({
      where: { userId_episodeId: { userId, episodeId } },
      update: { positionSecs, completed },
      create: { userId, episodeId, positionSecs, completed },
    });
    return { ok: true };
  }

  async continueWatching(userId: bigint) {
    const rows = await this.prisma.watchHistory.findMany({
      where: { userId, completed: false },
      orderBy: { updatedAt: 'desc' },
      take: 20,
      include: { episode: { include: { title: true } } },
    });

    return rows.map((r) => ({
      episodeId: r.episode.id.toString(),
      positionSecs: r.positionSecs,
      durationSecs: r.episode.durationSecs,
      thumbnailUrl: r.episode.thumbnailUrl,
      title: {
        slug: r.episode.title.slug,
        name: r.episode.title.name,
        posterUrl: r.episode.title.posterUrl,
        kind: r.episode.title.kind,
      },
      season: r.episode.season,
      number: r.episode.number,
    }));
  }

  async createForTitle(titleId: bigint, dto: { season?: number; number?: number; name?: string }) {
    const slot = await this.nextSlot(titleId, dto.season, dto.number);
    const { uploadUrl, videoUid } = await this.stream.createDirectUpload();
    const episode = await this.prisma.episode.create({
      data: {
        titleId,
        season: slot.season,
        number: slot.number,
        name: dto.name,
        cfVideoUid: videoUid,
        cfStatus: 'uploading',
      },
    });
    return { episode: { ...episode, id: episode.id.toString(), titleId: episode.titleId.toString() }, uploadUrl };
  }

  /**
   * A fresh Cloudflare direct-upload URL for an existing episode. Needed
   * because the one-time URL from createForTitle() isn't persisted
   * client-side across a page reload — re-associates the episode with a
   * new Cloudflare video UID each time it's called.
   */
  async getUploadUrl(episodeId: bigint) {
    const episode = await this.prisma.episode.findUnique({ where: { id: episodeId } });
    if (!episode) throw new NotFoundException('Episode not found.');

    // Re-pointing at a fresh upload orphans the previous Cloudflare video.
    // If it hadn't finished (still uploading), delete it so it doesn't
    // linger as a "pending" upload in the dashboard forever. A ready video
    // is left alone — it's a real, previously-uploaded cut.
    if (episode.cfVideoUid && episode.cfStatus !== 'ready') {
      await this.stream.deleteVideo(episode.cfVideoUid);
    }

    const { uploadUrl, videoUid } = await this.stream.createDirectUpload();
    await this.prisma.episode.update({
      where: { id: episodeId },
      data: { cfVideoUid: videoUid, cfStatus: 'uploading' },
    });
    return { uploadUrl };
  }

  /**
   * Resumable-upload URL for an existing episode. Deletes the superseded
   * placeholder first (same anti-orphan logic as getUploadUrl) then
   * creates a TUS upload sized to the incoming file.
   */
  async getTusUploadUrl(episodeId: bigint, uploadLength: number, filename: string) {
    const episode = await this.prisma.episode.findUnique({ where: { id: episodeId } });
    if (!episode) throw new NotFoundException('Episode not found.');

    if (episode.cfVideoUid && episode.cfStatus !== 'ready') {
      await this.stream.deleteVideo(episode.cfVideoUid);
    }

    const { uploadUrl, videoUid } = await this.stream.createTusUpload(uploadLength, filename);
    await this.prisma.episode.update({
      where: { id: episodeId },
      data: { cfVideoUid: videoUid, cfStatus: 'uploading' },
    });
    return { uploadUrl };
  }

  /**
   * Next free (season, number) for a title. Every create path defaulted to
   * S1E1, so importing a second video into a title blew up on the
   * (title_id, season, number) unique constraint with an opaque 500.
   */
  private async nextSlot(
    titleId: bigint,
    season?: number,
    number?: number,
  ): Promise<{ season: number; number: number }> {
    const s = season ?? 1;
    if (number != null) {
      const clash = await this.prisma.episode.findFirst({
        where: { titleId, season: s, number },
        select: { id: true },
      });
      if (clash) {
        throw new HttpException(
          `Season ${s} episode ${number} already exists for this title. Use a different number, or delete the existing video first.`,
          HttpStatus.CONFLICT,
        );
      }
      return { season: s, number };
    }
    const last = await this.prisma.episode.findFirst({
      where: { titleId, season: s },
      orderBy: { number: 'desc' },
      select: { number: true },
    });
    return { season: s, number: (last?.number ?? 0) + 1 };
  }

  /**
   * Import a video into an episode straight from a URL via Cloudflare's
   * server-side ingest — the reliable path for large files (no ~200MB
   * browser-upload ceiling). Deletes any superseded placeholder first.
   */
  async importFromUrl(titleId: bigint, url: string, name: string, dto: { season?: number; number?: number }) {
    // Resolve the slot BEFORE telling Cloudflare to ingest, so a duplicate
    // doesn't leave an orphaned video sitting in Stream.
    const slot = await this.nextSlot(titleId, dto.season, dto.number);
    const { videoUid } = await this.stream.copyFromUrl(url, name);
    const episode = await this.prisma.episode.create({
      data: {
        titleId,
        season: slot.season,
        number: slot.number,
        cfVideoUid: videoUid,
        cfStatus: 'uploading',
      },
    });
    return { ...episode, id: episode.id.toString(), titleId: episode.titleId.toString() };
  }

  /**
   * Reconcile Cloudflare against our DB: delete every Cloudflare video not
   * referenced by any episode (abandoned placeholders, superseded
   * re-uploads). Safe to run any time — only touches videos we've
   * "forgotten". Returns what it removed.
   */
  async cleanupOrphans() {
    const [cfVideos, episodes] = await Promise.all([
      this.stream.listVideos(),
      this.prisma.episode.findMany({ select: { cfVideoUid: true } }),
    ]);
    const known = new Set(episodes.map((e) => e.cfVideoUid).filter(Boolean) as string[]);
    const orphans = cfVideos.filter((v) => !known.has(v.uid));
    for (const v of orphans) {
      await this.stream.deleteVideo(v.uid);
    }
    return { removed: orphans.length, uids: orphans.map((v) => v.uid) };
  }

  /**
   * Checks directly with Cloudflare when an episode is still `uploading`/
   * `pending` rather than trusting the ready/error webhook alone ever
   * arrived — see the 2026-07-22 incident note on
   * CloudflareStreamService.getVideoStatus. No-ops (one extra Cloudflare
   * API call) for episodes already `ready` or `error`, so it's cheap to
   * call unconditionally on any read path that shows episode status.
   */
  async syncStatus(episode: Episode): Promise<Episode> {
    if (episode.cfStatus === 'ready' || episode.cfStatus === 'error' || !episode.cfVideoUid) {
      return episode;
    }

    const status = await this.stream.getVideoStatus(episode.cfVideoUid).catch(() => null);
    if (status?.ready) {
      await this.markReady(episode.cfVideoUid, status.durationSecs, status.thumbnailUrl);
    } else if (status?.errored) {
      await this.markError(episode.cfVideoUid);
    } else {
      return episode; // still genuinely pending, or the Cloudflare check itself failed
    }

    return this.prisma.episode.findUniqueOrThrow({ where: { id: episode.id } });
  }

  async markReady(videoUid: string, durationSecs: number, thumbnailUrl: string) {
    await this.prisma.episode.updateMany({
      where: { cfVideoUid: videoUid },
      data: { cfStatus: 'ready', durationSecs, thumbnailUrl },
    });
  }

  async markError(videoUid: string) {
    await this.prisma.episode.updateMany({
      where: { cfVideoUid: videoUid },
      data: { cfStatus: 'error' },
    });
  }
}
