import { HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EntitlementsService } from '../common/entitlements.service';
import { CloudflareStreamService } from './cloudflare-stream.service';

@Injectable()
export class EpisodesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementsService,
    private readonly stream: CloudflareStreamService,
  ) {}

  async play(userId: bigint, episodeId: bigint) {
    const episode = await this.prisma.episode.findUnique({ where: { id: episodeId } });
    if (!episode) throw new NotFoundException('Episode not found.');
    if (episode.cfStatus !== 'ready' || !episode.cfVideoUid) {
      throw new NotFoundException('Video is not ready for playback yet.');
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

    const history = await this.prisma.watchHistory.findUnique({
      where: { userId_episodeId: { userId, episodeId } },
    });

    const token = await this.stream.signPlaybackToken(episode.cfVideoUid);

    return {
      playbackUrl: this.stream.hlsUrl(episode.cfVideoUid, token),
      expiresIn: 3600,
      resumeAt: history?.positionSecs ?? 0,
    };
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

    const { uploadUrl, videoUid } = await this.stream.createDirectUpload();
    await this.prisma.episode.update({
      where: { id: episodeId },
      data: { cfVideoUid: videoUid, cfStatus: 'uploading' },
    });
    return { uploadUrl };
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
