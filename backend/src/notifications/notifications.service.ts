import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PushService } from './push.service';
import { DevicePlatform } from '@prisma/client';
import { notifiableAudience } from '../titles/audience';
import { readCatalogueMode } from '../titles/catalogue-mode';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
  ) {}

  /**
   * Record (or refresh) a device's push token.
   *
   * Keyed on the token because that is what FCM addresses. Re-registering an
   * existing token re-points it at the current user, which is what makes a
   * shared handset behave: whoever signed in last is who gets the push.
   */
  async registerDevice(input: {
    token: string;
    platform: DevicePlatform;
    userId?: bigint | null;
    appVersion?: string;
  }) {
    await this.prisma.device.upsert({
      where: { token: input.token },
      update: {
        platform: input.platform,
        userId: input.userId ?? null,
        appVersion: input.appVersion,
        lastSeenAt: new Date(),
      },
      create: {
        token: input.token,
        platform: input.platform,
        userId: input.userId ?? null,
        appVersion: input.appVersion,
      },
    });
    return { ok: true };
  }

  /** Called on sign-out so the handset stops receiving that user's pushes. */
  async unregisterDevice(token: string) {
    await this.prisma.device.deleteMany({ where: { token } });
    return { ok: true };
  }

  /**
   * Announce a title.
   *
   * `force` is the admin resend path. Without it the send is skipped when the
   * title has already been announced, so an admin toggling publish while
   * fixing artwork does not notify the whole user base repeatedly.
   */
  async announceTitle(titleId: bigint, opts: { force?: boolean; actorId?: bigint } = {}) {
    const title = await this.prisma.title.findUnique({ where: { id: titleId } });
    if (!title) throw new NotFoundException('Title not found');

    if (!title.published) return { skipped: 'not-published' as const };
    if (title.notifiedAt && !opts.force) return { skipped: 'already-notified' as const };

    const settings = await this.prisma.appSettings.findUnique({ where: { id: 1 } });
    if (settings && !settings.pushEnabled) return { skipped: 'push-disabled' as const };
    if (!(await this.push.isConfigured())) return { skipped: 'not-configured' as const };

    const audience = settings?.pushAudience ?? 'all';
    const body = title.description?.trim()
      ? title.description.trim()
      : `${title.name} is now available to watch.`;

    // Only the handsets that could open it. A tester tapping an announcement
    // for a live title, or an ordinary viewer tapping one for test content,
    // lands on "Title not found" — the notification promised something the
    // catalogue then denies.
    const visibleTo = notifiableAudience(title, await readCatalogueMode(this.prisma));

    const result = await this.push.sendToAudience(
      audience,
      {
        title: `New on ${settings?.appName ?? 'Muza Watch'}: ${title.name}`,
        body,
        path: `/title/${title.slug}`,
        imageUrl: title.bannerUrl ?? title.posterUrl ?? undefined,
      },
      visibleTo,
    );

    // Only count it as announced if it actually reached someone. A send to
    // zero devices announced nothing, so burning the title's one-shot flag
    // there would silently suppress it forever — which is exactly what
    // happened to titles published before any handset had registered.
    if (result.sent > 0) {
      await this.prisma.title.update({
        where: { id: titleId },
        data: { notifiedAt: new Date() },
      });
    }

    await this.prisma.notification.create({
      data: {
        title: `New on ${settings?.appName ?? 'Muza Watch'}: ${title.name}`.slice(0, 120),
        body: body.slice(0, 400),
        titleId,
        audience,
        sentCount: result.sent,
        failedCount: result.failed,
        createdBy: opts.actorId ?? null,
      },
    });

    this.logger.log(
      `Announced "${title.name}" to ${audience}: ${result.sent} sent, ${result.failed} failed, ${result.pruned} stale tokens pruned`,
    );
    return result;
  }

  /** Free-text broadcast, for announcements that are not a title release. */
  async broadcast(input: { title: string; body: string; path?: string; actorId?: bigint }) {
    const settings = await this.prisma.appSettings.findUnique({ where: { id: 1 } });
    if (settings && !settings.pushEnabled) return { skipped: 'push-disabled' as const };
    if (!(await this.push.isConfigured())) return { skipped: 'not-configured' as const };

    const audience = settings?.pushAudience ?? 'all';
    const result = await this.push.sendToAudience(audience, {
      title: input.title,
      body: input.body,
      path: input.path ?? '/',
    });

    await this.prisma.notification.create({
      data: {
        title: input.title.slice(0, 120),
        body: input.body.slice(0, 400),
        audience,
        sentCount: result.sent,
        failedCount: result.failed,
        createdBy: input.actorId ?? null,
      },
    });
    return result;
  }

  /** Send history for the admin UI. */
  async history(limit = 50) {
    const rows = await this.prisma.notification.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 200),
      include: { titleRef: { select: { name: true, slug: true } } },
    });
    return rows.map((r) => ({
      ...r,
      id: r.id.toString(),
      titleId: r.titleId?.toString() ?? null,
      createdBy: r.createdBy?.toString() ?? null,
    }));
  }

  /** Device counts, so an admin can see whether push is reaching anyone. */
  async deviceStats() {
    const [total, android, ios, signedIn] = await Promise.all([
      this.prisma.device.count(),
      this.prisma.device.count({ where: { platform: 'android' } }),
      this.prisma.device.count({ where: { platform: 'ios' } }),
      this.prisma.device.count({ where: { userId: { not: null } } }),
    ]);
    return { total, android, ios, signedIn, configured: await this.push.isConfigured() };
  }
}
