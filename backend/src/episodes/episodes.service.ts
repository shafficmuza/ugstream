import { HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Episode } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EntitlementsService } from '../common/entitlements.service';
import { CloudflareStreamService } from './cloudflare-stream.service';
import { R2Service } from '../media-storage/r2.service';
import { TranscodeService } from './transcode.service';
import { signHlsToken } from '../media-storage/hls-token';

@Injectable()
export class EpisodesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementsService,
    private readonly stream: CloudflareStreamService,
    private readonly r2: R2Service,
    private readonly transcode: TranscodeService,
    private readonly config: ConfigService,
  ) {}

  async play(userId: bigint, episodeId: bigint) {
    let episode = await this.prisma.episode.findUnique({ where: { id: episodeId } });
    if (!episode) throw new NotFoundException('Episode not found.');

    if (episode.videoProvider === 'r2_hls') {
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

    if (episode.videoProvider === 'r2_hls') {
      // Self-hosted 4K HLS on R2, delivered through the Cloudflare Worker.
      // The short-lived token authorises the whole prefix; the player
      // appends it to every segment request (the Worker checks it).
      const secret = this.config.get<string>('R2_HLS_TOKEN_SECRET');
      if (!secret) {
        throw new HttpException('R2 delivery not configured.', HttpStatus.SERVICE_UNAVAILABLE);
      }
      const hlsToken = signHlsToken(episode.r2Prefix!, secret, 3600);
      return {
        provider: 'r2_hls' as const,
        playbackUrl: `https://${this.r2.publicHost}/${episode.r2Prefix}master.m3u8`,
        hlsToken,
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
        season: dto.season ?? 1,
        number: dto.number ?? 1,
        name: dto.name,
        videoProvider: 'r2_hls',
        cfStatus: 'uploading',
      },
    });
    this.transcode.startTranscode(episode.id, sourceUrl);
    return { ...episode, id: episode.id.toString(), titleId: episode.titleId.toString() };
  }

  async saveProgress(userId: bigint, episodeId: bigint, positionSecs: number) {
    const episode = await this.prisma.episode.findUnique({ where: { id: episodeId } });
    if (!episode) throw new NotFoundException('Episode not found.');

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
      title: { slug: r.episode.title.slug, name: r.episode.title.name, posterUrl: r.episode.title.posterUrl },
      season: r.episode.season,
      number: r.episode.number,
    }));
  }

  async createForTitle(titleId: bigint, dto: { season?: number; number?: number; name?: string }) {
    const { uploadUrl, videoUid } = await this.stream.createDirectUpload();
    const episode = await this.prisma.episode.create({
      data: {
        titleId,
        season: dto.season ?? 1,
        number: dto.number ?? 1,
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
   * Import a video into an episode straight from a URL via Cloudflare's
   * server-side ingest — the reliable path for large files (no ~200MB
   * browser-upload ceiling). Deletes any superseded placeholder first.
   */
  async importFromUrl(titleId: bigint, url: string, name: string, dto: { season?: number; number?: number }) {
    const { videoUid } = await this.stream.copyFromUrl(url, name);
    const episode = await this.prisma.episode.create({
      data: {
        titleId,
        season: dto.season ?? 1,
        number: dto.number ?? 1,
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
