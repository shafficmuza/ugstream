import { Controller, Get, UseGuards } from '@nestjs/common';
import { statfs } from 'fs/promises';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { StaffGuard } from '../common/guards/staff.guard';

/**
 * What is happening on the platform right now, for the admin dashboard.
 *
 * Deliberately one endpoint rather than three: the three numbers are read
 * together, a few seconds apart forever, and splitting them would triple the
 * request count for a screen that is open all day on someone's second monitor.
 *
 * Everything here is a point-in-time read. The dashboard polls; there is no
 * socket. A persistent connection per open dashboard is a new failure mode on
 * a box that also serves the site, and the data changes on the order of
 * seconds — polling loses nothing anybody can perceive.
 */

/**
 * A lease not renewed within this window is treated as finished. Must match
 * StreamLease's own staleness rule, or the dashboard and the device cap will
 * disagree about who is watching — and the cap is the one users feel.
 */
const WATCHING_STALE_MS = 60_000;

/**
 * A session is "online" if it has spoken to the API this recently. Longer than
 * the lease window on purpose: an app sitting on the home screen is still a
 * signed-in device someone is holding, it is just not streaming.
 */
const ONLINE_WINDOW_MS = 5 * 60_000;

/** The filesystem the uploads actually land on. */
const DISK_PATH = process.env.UPLOADS_DISK_PATH ?? process.cwd();

@UseGuards(JwtAuthGuard, StaffGuard)
@Controller('admin/live')
export class AdminLiveController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async get() {
    const now = new Date();
    const watchingSince = new Date(now.getTime() - WATCHING_STALE_MS);
    const onlineSince = new Date(now.getTime() - ONLINE_WINDOW_MS);

    const [disk, leases, signedIn, onlineSessions, devices] = await Promise.all([
      this.disk(),
      this.prisma.streamLease.findMany({
        where: { endedAt: null, lastSeenAt: { gt: watchingSince } },
        orderBy: { startedAt: 'asc' },
        take: 200,
      }),
      this.prisma.session.count({ where: { revokedAt: null } }),
      this.prisma.session.findMany({
        where: { revokedAt: null, lastSeenAt: { gt: onlineSince } },
        select: { id: true, userId: true, deviceLabel: true, lastSeenAt: true },
        orderBy: { lastSeenAt: 'desc' },
        take: 200,
      }),
      this.prisma.device.groupBy({
        by: ['platform'],
        where: { lastSeenAt: { gt: onlineSince } },
        _count: { _all: true },
      }),
    ]);

    // Names for the leases, in two batched reads rather than a query per row.
    const userIds = [...new Set([...leases.map((l) => l.userId), ...onlineSessions.map((s) => s.userId)])];
    const episodeIds = [...new Set(leases.map((l) => l.episodeId))];
    const [users, episodes] = await Promise.all([
      userIds.length
        ? this.prisma.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, phone: true, displayName: true },
          })
        : [],
      episodeIds.length
        ? this.prisma.episode.findMany({
            where: { id: { in: episodeIds } },
            select: { id: true, season: true, number: true, name: true, title: { select: { name: true, kind: true } } },
          })
        : [],
    ]);
    const userById = new Map(users.map((u) => [u.id.toString(), u] as const));
    const epById = new Map(episodes.map((e) => [e.id.toString(), e] as const));

    return {
      at: now.toISOString(),
      disk,
      watching: {
        count: leases.length,
        // Distinct people, which is the number worth reading aloud: one
        // household on two devices is two streams but one viewer.
        viewers: new Set(leases.map((l) => l.userId.toString())).size,
        streams: leases.map((l) => {
          const u = userById.get(l.userId.toString());
          const e = epById.get(l.episodeId.toString());
          return {
            userId: l.userId.toString(),
            who: u?.displayName?.trim() || u?.phone || 'Unknown',
            phone: u?.phone ?? null,
            title: e?.title?.name ?? 'Unknown title',
            episode: e ? (e.title.kind === 'series' ? `S${e.season}E${e.number}${e.name ? ` · ${e.name}` : ''}` : null) : null,
            device: l.deviceLabel,
            startedAt: l.startedAt.toISOString(),
            lastSeenAt: l.lastSeenAt.toISOString(),
            watchingForSecs: Math.max(0, Math.round((now.getTime() - l.startedAt.getTime()) / 1000)),
          };
        }),
      },
      sessions: {
        // Every session that has not been logged out or evicted — the fleet.
        signedIn,
        // …of which these have called the API inside the online window.
        onlineNow: onlineSessions.length,
        onlineWindowSecs: ONLINE_WINDOW_MS / 1000,
        devices: onlineSessions.map((s) => {
          const u = userById.get(s.userId.toString());
          return {
            sessionId: s.id,
            who: u?.displayName?.trim() || u?.phone || 'Unknown',
            device: s.deviceLabel,
            lastSeenAt: s.lastSeenAt.toISOString(),
            idleSecs: Math.max(0, Math.round((now.getTime() - s.lastSeenAt.getTime()) / 1000)),
          };
        }),
        // Push-registered installs seen recently, by platform. A different
        // question from sessions: one handset, one row, regardless of who is
        // signed in on it.
        byPlatform: Object.fromEntries(devices.map((d) => [d.platform, d._count._all])),
      },
    };
  }

  /**
   * Free space on the volume the uploads land on. statfs rather than shelling
   * out to df: no subprocess per poll, and no parsing of output that changes
   * format between coreutils versions.
   */
  private async disk() {
    try {
      const s = await statfs(DISK_PATH);
      const total = s.blocks * s.bsize;
      // bavail, not bfree: the reserved blocks are not space this process can
      // ever use, and reporting them as free is how a disk "with room" stops
      // accepting uploads.
      const free = s.bavail * s.bsize;
      const used = total - free;
      return {
        path: DISK_PATH,
        totalBytes: total,
        usedBytes: used,
        freeBytes: free,
        usedPct: total > 0 ? Math.round((used / total) * 1000) / 10 : 0,
      };
    } catch {
      // A dashboard that 500s because one number is unavailable is worse than
      // one that says so.
      return { path: DISK_PATH, totalBytes: 0, usedBytes: 0, freeBytes: 0, usedPct: 0, unavailable: true };
    }
  }
}
