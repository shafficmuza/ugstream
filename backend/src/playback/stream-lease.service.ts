import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * How long a lease survives without a heartbeat before its slot is reclaimed.
 *
 * Both players report progress every 15s, so this tolerates four consecutive
 * missed ticks. Shorter and a brief network stall would evict someone
 * mid-episode; much longer and closing a laptop would strand a slot for
 * minutes, which is exactly the frustration a limit like this must avoid —
 * being told "too many streams" while nothing is actually playing.
 */
const STALE_AFTER_MS = 60_000;

@Injectable()
export class StreamLeaseService {
  private readonly logger = new Logger(StreamLeaseService.name);

  constructor(private readonly prisma: PrismaService) {}

  private async maxStreams(): Promise<number> {
    const settings = await this.prisma.appSettings.findUnique({ where: { id: 1 } });
    // 0 or a negative value means "unlimited" — an admin turning the feature
    // off should not have to know a magic large number.
    return settings?.maxStreams ?? 2;
  }

  private cutoff(): Date {
    return new Date(Date.now() - STALE_AFTER_MS);
  }

  /**
   * Claim a concurrent-stream slot for this session, or throw 409 if the
   * account is already at its limit.
   *
   * Re-entrant by design: the same session calling again just refreshes its
   * own lease, so seeking, switching episodes or reloading the player never
   * costs a second slot.
   */
  async acquire(
    userId: bigint,
    sessionId: string,
    episodeId: bigint,
    deviceLabel?: string | null,
  ): Promise<void> {
    const limit = await this.maxStreams();
    if (limit <= 0) return;

    const now = new Date();

    // Count only *other* sessions that are genuinely still watching.
    const active = await this.prisma.streamLease.count({
      where: {
        userId,
        sessionId: { not: sessionId },
        endedAt: null,
        lastSeenAt: { gt: this.cutoff() },
      },
    });

    if (active >= limit) {
      // 409 rather than 403: the request is well-formed and the user is
      // entitled — it conflicts with their own other playback. The frontend
      // keys off this status to show "stop playing elsewhere" instead of a
      // subscription prompt.
      throw new HttpException(
        {
          statusCode: HttpStatus.CONFLICT,
          error: 'StreamLimitReached',
          message:
            limit === 1
              ? 'This account is already playing on another device. Stop it there to watch here.'
              : `This account is already playing on ${limit} devices. Stop one to watch here.`,
          limit,
        },
        HttpStatus.CONFLICT,
      );
    }

    await this.prisma.streamLease.upsert({
      where: { sessionId },
      create: { userId, sessionId, episodeId, deviceLabel: deviceLabel ?? null },
      update: { userId, episodeId, lastSeenAt: now, endedAt: null, startedAt: now },
    });
  }

  /**
   * Keep an existing lease alive. Called from the progress heartbeat, so it
   * must stay cheap and must never throw — a failed heartbeat should degrade
   * to "the lease goes stale", never interrupt someone's playback.
   */
  async touch(sessionId: string, episodeId: bigint): Promise<void> {
    try {
      await this.prisma.streamLease.updateMany({
        where: { sessionId, endedAt: null },
        data: { lastSeenAt: new Date(), episodeId },
      });
    } catch (e) {
      this.logger.warn(`Failed to refresh stream lease for session ${sessionId}: ${e}`);
    }
  }

  /** Free the slot immediately when playback stops cleanly. */
  async release(sessionId: string): Promise<void> {
    try {
      await this.prisma.streamLease.updateMany({
        where: { sessionId, endedAt: null },
        data: { endedAt: new Date() },
      });
    } catch (e) {
      this.logger.warn(`Failed to release stream lease for session ${sessionId}: ${e}`);
    }
  }

  /** What the account currently has playing — powers the admin/user view. */
  async activeFor(userId: bigint) {
    return this.prisma.streamLease.findMany({
      where: { userId, endedAt: null, lastSeenAt: { gt: this.cutoff() } },
      orderBy: { startedAt: 'asc' },
    });
  }
}
