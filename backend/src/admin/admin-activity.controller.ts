import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AdminGuard } from '../common/guards/admin.guard';

/**
 * Content audit trail — who uploaded/created what, when. Admin-only. Returns
 * recent activity enriched with the acting user's name and the title, ready
 * for a day-by-day view.
 */
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/activity')
export class AdminActivityController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@Query('days') days?: string) {
    const n = Math.min(60, Math.max(1, parseInt(days ?? '14', 10) || 14));
    const since = new Date(Date.now() - n * 24 * 60 * 60 * 1000);

    const logs = await this.prisma.activityLog.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: 1000,
    });

    const userIds = [...new Set(logs.map((l) => l.userId))];
    const titleIds = [...new Set(logs.map((l) => l.titleId).filter((x): x is bigint => x !== null))];
    const [users, titles] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, displayName: true, phone: true, role: true },
      }),
      this.prisma.title.findMany({ where: { id: { in: titleIds } }, select: { id: true, name: true } }),
    ]);
    const uMap = new Map(users.map((u) => [u.id.toString(), u]));
    const tMap = new Map(titles.map((t) => [t.id.toString(), t]));

    return logs.map((l) => {
      const u = uMap.get(l.userId.toString());
      const t = l.titleId ? tMap.get(l.titleId.toString()) : null;
      return {
        id: l.id.toString(),
        action: l.action,
        summary: l.summary,
        createdAt: l.createdAt,
        day: l.createdAt.toISOString().slice(0, 10),
        user: u ? { name: u.displayName || u.phone, phone: u.phone, role: u.role } : { name: 'unknown', phone: '', role: '' },
        title: t ? { id: t.id.toString(), name: t.name } : null,
      };
    });
  }
}
