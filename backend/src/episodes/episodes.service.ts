import { HttpException, HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { Episode, StreamStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EntitlementsService } from '../common/entitlements.service';
import { CloudflareStreamService } from './cloudflare-stream.service';
import { R2Service } from '../media-storage/r2.service';
import { TranscodeService } from './transcode.service';
import { ThumbnailPickerService } from './thumbnail-picker.service';
import { StreamLeaseService } from '../playback/stream-lease.service';

@Injectable()
export class EpisodesService {
  private readonly logger = new Logger(EpisodesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementsService,
    private readonly stream: CloudflareStreamService,
    private readonly r2: R2Service,
    private readonly transcode: TranscodeService,
    private readonly picker: ThumbnailPickerService,
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
      // The authoritative running time, from Cloudflare's own API or the
      // playlist probe. A player reading duration off an HLS manifest gets a
      // sum of EXTINF values that can be a segment out, or 0 while the
      // manifest is still loading — clients use this to clamp seeks instead.
      durationSecs: episode.durationSecs ?? 0,
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

    // The token must outlive an entire sitting, not just an hour: Cloudflare
    // validates it on EVERY segment request, so with the old 1h default any
    // film longer than ~60 minutes died mid-stream with "invalid token" (and
    // a pause-then-resume after an hour hit the same wall). Size it to the
    // film plus generous pause room, with a 12h floor; the players also
    // self-recover by re-requesting playback if it ever does lapse.
    const tokenTtlSecs = Math.max(12 * 3600, (episode.durationSecs ?? 0) + 4 * 3600);
    const token = await this.stream.signPlaybackToken(episode.cfVideoUid!, tokenTtlSecs);
    return {
      provider: 'cloudflare' as const,
      playbackUrl: this.stream.hlsUrl(episode.cfVideoUid!, token),
      expiresIn: tokenTtlSecs,
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
    const slot = await this.claimSlot(titleId, dto.season, dto.number);
    const episode = await this.writeSlot(
      titleId,
      slot,
      { videoProvider: 'r2_hls', cfStatus: 'uploading' },
      dto.name,
    );
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
    const slot = await this.claimSlot(titleId, dto.season, dto.number);
    const episode = await this.writeSlot(
      titleId,
      slot,
      { videoProvider: 'r2_file', r2Prefix: key, cfStatus: 'ready' },
      dto.name,
    );
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
    const slot = await this.claimSlot(titleId, dto.season, dto.number);
    const episode = await this.writeSlot(
      titleId,
      slot,
      { videoProvider: 'r2_hls', cfStatus: 'uploading' },
      dto.name,
    );
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
    const slot = await this.claimSlot(titleId, dto.season, dto.number);
    const episode = await this.writeSlot(
      titleId,
      slot,
      {
        videoProvider: 'r2_hls',
        r2Prefix: prefix,
        cfStatus: 'ready',
        durationSecs: durationSecs ? Math.round(durationSecs) : null,
      },
      dto.name,
    );
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

  /**
   * Create an empty episode slot. Deliberately does NOT touch Cloudflare:
   * the old version eagerly created a direct-upload placeholder here and
   * marked the row 'uploading', so every "+ Add episode" where the admin
   * never picked a file (or the browser died before the first chunk) left
   * a row lying about an upload that never started — nine episodes were
   * found stuck that way on 2026-08-08. The Cloudflare upload is created
   * only when bytes are actually about to move (tus-upload / upload-url).
   */
  async createForTitle(titleId: bigint, dto: { season?: number; number?: number; name?: string }) {
    const slot = await this.nextSlot(titleId, dto.season, dto.number);
    const episode = await this.prisma.episode.create({
      data: {
        titleId,
        season: slot.season,
        number: slot.number,
        name: dto.name,
        cfStatus: 'pending',
      },
    });
    return { episode: { ...episode, id: episode.id.toString(), titleId: episode.titleId.toString() } };
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
   * What a video is called on Cloudflare's side.
   *
   * The import form sends no name, so every video landed there as the literal
   * fallback string — 142 of them called "Imported video", which makes the
   * Stream dashboard useless for finding anything, and leaves no way to tell
   * which video belongs to which episode when reconciling by hand.
   *
   * Derived from the title instead: "The Asset — S1E2" for a series, the
   * title's name for a movie, with any episode name appended. A caller that
   * passes a real name of its own still wins.
   */
  private async streamLabel(
    titleId: bigint,
    season: number,
    number: number,
    provided?: string,
  ): Promise<string> {
    const given = provided?.trim();
    if (given && given.toLowerCase() !== 'imported video') return given;

    const title = await this.prisma.title
      .findUnique({ where: { id: titleId }, select: { name: true, kind: true } })
      .catch(() => null);
    if (!title) return given || 'Imported video';

    return title.kind === 'series'
      ? `${title.name} — S${season}E${number}`
      : title.name;
  }

  /**
   * The episode row an ingest should write into: an existing EMPTY slot if the
   * admin already created one, otherwise a free slot to create.
   *
   * An empty slot is a row from "+ Add episode" that never received a video.
   * Treating it as a clash is what made series unimportable: the admin lays
   * out S1E1..E6 in advance, then every server-side import answers 409 and the
   * only remaining route is a multi-gigabyte browser upload. A slot that
   * already holds a video is still a real conflict and still refused.
   */
  private async claimSlot(
    titleId: bigint,
    season?: number,
    number?: number,
  ): Promise<{ season: number; number: number; existingId: bigint | null }> {
    const s = season ?? 1;
    if (number != null) {
      const existing = await this.prisma.episode.findFirst({
        where: { titleId, season: s, number },
        select: { id: true, cfVideoUid: true, r2Prefix: true },
      });
      if (existing) {
        const holdsVideo = existing.cfVideoUid != null || existing.r2Prefix != null;
        if (holdsVideo) {
          throw new HttpException(
            `Season ${s} episode ${number} already has a video. Delete it first, or use a different number.`,
            HttpStatus.CONFLICT,
          );
        }
        return { season: s, number, existingId: existing.id };
      }
      return { season: s, number, existingId: null };
    }
    const slot = await this.nextSlot(titleId, s, undefined);
    return { ...slot, existingId: null };
  }

  /**
   * Write an ingested video into the slot claimSlot resolved: fill the empty
   * row in place, or create it when the admin never laid one out. Paired with
   * claimSlot rather than folded into it because the Cloudflare import must
   * claim the slot BEFORE asking Stream to ingest (a clash would otherwise
   * orphan a video) and only write the row afterwards.
   */
  private async writeSlot(
    titleId: bigint,
    slot: { season: number; number: number; existingId: bigint | null },
    video: {
      videoProvider: string;
      cfStatus: StreamStatus;
      cfVideoUid?: string;
      r2Prefix?: string;
      durationSecs?: number | null;
    },
    name?: string,
  ): Promise<Episode> {
    if (slot.existingId) {
      return this.prisma.episode.update({
        where: { id: slot.existingId },
        // A slot the admin already labelled keeps its name unless this
        // upload carries one of its own.
        data: { ...video, ...(name ? { name } : {}) },
      });
    }
    return this.prisma.episode.create({
      data: { titleId, season: slot.season, number: slot.number, name, ...video },
    });
  }

  /**
   * Import a video into an episode straight from a URL via Cloudflare's
   * server-side ingest — the reliable path for large files (no ~200MB
   * browser-upload ceiling). Deletes any superseded placeholder first.
   */
  async importFromUrl(titleId: bigint, url: string, name: string, dto: { season?: number; number?: number }) {
    // Resolve the slot BEFORE telling Cloudflare to ingest, so a duplicate
    // doesn't leave an orphaned video sitting in Stream. An empty slot the
    // admin created in advance is filled rather than refused.
    const slot = await this.claimSlot(titleId, dto.season, dto.number);
    this.logger.log(`Importing S${slot.season}E${slot.number} of title ${titleId} from ${url}`);
    const label = await this.streamLabel(titleId, slot.season, slot.number, name);
    const { videoUid } = await this.stream.copyFromUrl(url, label);

    // `name` is the Cloudflare-side video label, not the episode's — a slot's
    // own name is left alone here.
    const episode = await this.writeSlot(titleId, slot, {
      videoProvider: 'cloudflare',
      cfVideoUid: videoUid,
      cfStatus: 'uploading',
    });
    this.logger.log(
      `Cloudflare accepted the import for S${slot.season}E${slot.number} as video ${videoUid}. ` +
        `It now has to download the file itself — watch for the ready/missing line from syncStatus.`,
    );
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
    if (orphans.length) {
      // Named individually because this is destructive and irreversible, and
      // because an import that is mid-flight is briefly indistinguishable
      // from an orphan: the video exists on Cloudflare for the moment
      // between copyFromUrl returning and the episode row being written.
      this.logger.warn(
        `Deleting ${orphans.length} Cloudflare video(s) not referenced by any episode: ` +
          orphans.map((v) => `${v.uid} (${v.state})`).join(', '),
      );
    }
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
    if (!status) {
      return episode; // the Cloudflare check itself failed — decide nothing
    }
    const where = `S${episode.season}E${episode.number} (episode ${episode.id}, video ${episode.cfVideoUid})`;

    if (status.ready) {
      this.logger.log(`${where} is ready on Cloudflare (${status.durationSecs}s).`);
      await this.markReady(episode.cfVideoUid, status.durationSecs, status.thumbnailUrl);
    } else if (status.errored) {
      this.logger.error(`${where} failed to encode on Cloudflare. Delete it and re-import.`);
      await this.markError(episode.cfVideoUid);
    } else if (status.missing || this.uploadIsDead(status)) {
      // The upload will never arrive: the Cloudflare video vanished
      // (expired placeholder), or it has sat in 'pendingupload' far longer
      // than any live browser upload survives. Reclaim the slot so the row
      // stops claiming "uploading" forever and the admin can retry.
      //
      // Logged loudly because this silently undoes an import that looked
      // like it worked: the row goes back to an empty slot with no video and
      // no explanation, which is indistinguishable from never having tried.
      // Nine episodes sat in exactly that state with nothing to show why.
      this.logger.warn(
        status.missing
          ? `${where} no longer exists on Cloudflare — the video was deleted there ` +
              `(check "cleanup orphans", or deletion from the Cloudflare dashboard). ` +
              `Resetting the slot to empty.`
          : `${where} never received any bytes and is older than 24h — the upload is ` +
              `dead and cannot resume. Resetting the slot to empty.`,
      );
      await this.stream.deleteVideo(episode.cfVideoUid);
      await this.prisma.episode.update({
        where: { id: episode.id },
        data: { cfVideoUid: null, cfStatus: 'pending' },
      });
    } else {
      // Genuinely still working: 'downloading' for a URL import, 'queued' or
      // 'inprogress' while Cloudflare encodes.
      this.logger.log(`${where} still in progress on Cloudflare (state: ${status.state}).`);
      return episode;
    }

    return this.prisma.episode.findUniqueOrThrow({ where: { id: episode.id } });
  }

  /**
   * A video still in 'pendingupload' this long after creation is
   * unrecoverable: the one-time tus URL lives only in the browser tab that
   * requested it, and re-picking a file always requests a fresh upload —
   * so nothing can ever resume it. 24h is deliberately generous so a slow
   * overnight upload that IS still moving is never shot down.
   */
  private uploadIsDead(status: { state: string; createdAt: Date | null }): boolean {
    const DEAD_UPLOAD_AGE_MS = 24 * 60 * 60 * 1000;
    return (
      status.state === 'pendingupload' &&
      status.createdAt != null &&
      Date.now() - status.createdAt.getTime() > DEAD_UPLOAD_AGE_MS
    );
  }

  /**
   * Explicitly abandon an in-flight/failed upload and return the row to
   * 'pending', so the admin UI shows a clean slot again. Never touches a
   * ready video.
   *
   * Self-hosted episodes are resettable too. Refusing them left a transcode
   * that had died — a restart mid-encode, or ffmpeg failing — stuck on
   * 'uploading'/'error' with no way back: syncStatus skips a row with no
   * cfVideoUid, so nothing healed it and the slot was unusable for good.
   */
  async cancelUpload(episodeId: bigint) {
    const episode = await this.prisma.episode.findUnique({ where: { id: episodeId } });
    if (!episode) throw new NotFoundException('Episode not found.');
    if (episode.cfStatus === 'ready') {
      throw new HttpException('This episode is already ready — nothing to cancel.', HttpStatus.CONFLICT);
    }
    if (episode.cfVideoUid) {
      await this.stream.deleteVideo(episode.cfVideoUid);
    }
    const updated = await this.prisma.episode.update({
      where: { id: episodeId },
      // r2Prefix goes too: a half-written ladder is not a video, and leaving
      // it set would make claimSlot read the empty slot as "already holds a
      // video" and refuse the retry. videoProvider returns to the default so
      // the row is indistinguishable from a fresh slot — otherwise the admin
      // UI keeps hiding the per-row upload input on a slot that is now empty.
      data: { cfVideoUid: null, r2Prefix: null, cfStatus: 'pending', videoProvider: 'cloudflare' },
    });
    return { ...updated, id: updated.id.toString(), titleId: updated.titleId.toString() };
  }

  async markReady(videoUid: string, durationSecs: number, _thumbnailUrl: string) {
    // Cloudflare's own thumbnail URL is deliberately ignored. It is the
    // unsigned form, and these videos require signed URLs, so storing it left
    // every episode showing a broken image. Point at our own endpoint instead:
    // it signs on demand, so the link never expires and never needs rewriting.
    const rows = await this.prisma.episode.findMany({
      where: { cfVideoUid: videoUid },
      select: { id: true },
    });
    await this.prisma.episode.updateMany({
      where: { cfVideoUid: videoUid },
      data: { cfStatus: 'ready', durationSecs },
    });
    for (const row of rows) {
      await this.prisma.episode.update({
        where: { id: row.id },
        data: { thumbnailUrl: `/api/v1/episodes/${row.id}/thumbnail` },
      });
    }
  }

  /**
   * A signed still for an episode, for the thumbnail endpoint to redirect to.
   * Tokens are minted per video and cached, because a season page asks for one
   * per episode and each mint is a round trip to Cloudflare.
   */
  private readonly thumbTokens = new Map<string, { token: string; expiresAt: number }>();

  async signedThumbnailUrl(episodeId: bigint): Promise<string | null> {
    const episode = await this.prisma.episode.findUnique({ where: { id: episodeId } });
    if (!episode?.cfVideoUid || episode.videoProvider !== 'cloudflare') return null;

    const now = Date.now();
    const cached = this.thumbTokens.get(episode.cfVideoUid);
    let token = cached && cached.expiresAt > now + 60_000 ? cached.token : null;
    if (!token) {
      const ttl = 3600;
      token = await this.stream.signPlaybackToken(episode.cfVideoUid, ttl);
      this.thumbTokens.set(episode.cfVideoUid, { token, expiresAt: now + ttl * 1000 });
    }
    return this.stream.thumbnailUrl(token, { height: 360 });
  }

  /**
   * Choose the still for an episode by looking at the video rather than
   * trusting Cloudflare's fixed default frame, which is routinely a fade-in or
   * a studio card. The winning moment is stored on Cloudflare itself, so every
   * later thumbnail request returns it with no timestamp to remember.
   */
  async autoPickThumbnail(episodeId: bigint) {
    const episode = await this.prisma.episode.findUnique({ where: { id: episodeId } });
    if (!episode) throw new NotFoundException('Episode not found.');
    if (episode.videoProvider !== 'cloudflare' || !episode.cfVideoUid) {
      throw new HttpException(
        'Scene picking currently covers Cloudflare-hosted episodes only.',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (episode.cfStatus !== 'ready') {
      throw new HttpException(
        'This episode is not ready yet, so there are no frames to choose from.',
        HttpStatus.CONFLICT,
      );
    }
    const duration = episode.durationSecs ?? 0;
    if (duration < 5) {
      throw new HttpException('This episode has no usable duration.', HttpStatus.CONFLICT);
    }

    const token = await this.stream.signPlaybackToken(episode.cfVideoUid, 900);
    const { best, candidates } = await this.picker.pickBestFrame(
      (timeSecs) => this.stream.thumbnailUrl(token, { timeSecs, height: 360 }),
      duration,
    );
    if (!best) {
      throw new HttpException('No usable frame was found.', HttpStatus.UNPROCESSABLE_ENTITY);
    }

    await this.stream.setThumbnailTimestampPct(episode.cfVideoUid, best.timeSecs / duration);
    const updated = await this.prisma.episode.update({
      where: { id: episodeId },
      data: { thumbnailUrl: `/api/v1/episodes/${episodeId}/thumbnail` },
    });
    this.logger.log(
      `Episode ${episodeId} thumbnail set to ${best.timeSecs}s ` +
        `(${best.bytes}B, brightness ${best.brightness.toFixed(1)}), ` +
        `${candidates.filter((c) => c.rejected).length}/${candidates.length} candidates rejected`,
    );
    return {
      episodeId: episodeId.toString(),
      chosenTimeSecs: best.timeSecs,
      thumbnailUrl: updated.thumbnailUrl,
      candidates,
    };
  }

  /**
   * Re-label every Cloudflare video from the catalogue it belongs to, so the
   * Stream dashboard reads as the library rather than 142 rows called
   * "Imported video". Renaming is metadata only — playback, thumbnails and
   * the video id are untouched.
   */
  async renameStreamVideosFromCatalogue(): Promise<{ renamed: number; failed: number }> {
    const episodes = await this.prisma.episode.findMany({
      where: { videoProvider: 'cloudflare', cfVideoUid: { not: null } },
      select: {
        id: true,
        season: true,
        number: true,
        name: true,
        cfVideoUid: true,
        title: { select: { name: true, kind: true } },
      },
      orderBy: { id: 'asc' },
    });

    let renamed = 0;
    let failed = 0;
    for (const ep of episodes) {
      const base =
        ep.title.kind === 'series'
          ? `${ep.title.name} — S${ep.season}E${ep.number}`
          : ep.title.name;
      const label = ep.name?.trim() ? `${base} · ${ep.name.trim()}` : base;
      try {
        await this.stream.setVideoName(ep.cfVideoUid!, label);
        renamed++;
      } catch (e: any) {
        failed++;
        this.logger.warn(`Could not rename video for episode ${ep.id}: ${e?.message ?? e}`);
      }
    }
    this.logger.log(`Renamed ${renamed} Cloudflare videos from the catalogue (${failed} failed)`);
    return { renamed, failed };
  }

  /** Same, for every ready Cloudflare episode of a title. */
  async autoPickThumbnailsForTitle(titleId: bigint) {
    const episodes = await this.prisma.episode.findMany({
      where: { titleId, cfStatus: 'ready', videoProvider: 'cloudflare' },
      orderBy: [{ season: 'asc' }, { number: 'asc' }],
      select: { id: true, season: true, number: true },
    });
    const results: Array<{ season: number; number: number; chosenTimeSecs?: number; error?: string }> = [];
    for (const ep of episodes) {
      try {
        const r = await this.autoPickThumbnail(ep.id);
        results.push({ season: ep.season, number: ep.number, chosenTimeSecs: r.chosenTimeSecs });
      } catch (e: any) {
        results.push({ season: ep.season, number: ep.number, error: e?.message ?? 'failed' });
      }
    }
    return { total: episodes.length, results };
  }

  async markError(videoUid: string) {
    await this.prisma.episode.updateMany({
      where: { cfVideoUid: videoUid },
      data: { cfStatus: 'error' },
    });
  }
}
