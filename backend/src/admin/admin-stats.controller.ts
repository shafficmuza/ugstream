import { Controller, Get, UseGuards } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { StaffGuard } from '../common/guards/staff.guard';

@UseGuards(JwtAuthGuard, StaffGuard)
@Controller('admin/stats')
export class AdminStatsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async get() {
    const now = new Date();

    const [
      userCount,
      activeSubscriptions,
      titleCount,
      publishedTitleCount,
      revenueResult,
      recentSignups,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.subscription.count({ where: { expiresAt: { gt: now } } }),
      this.prisma.title.count(),
      this.prisma.title.count({ where: { published: true } }),
      this.prisma.payment.aggregate({
        where: { status: 'successful' },
        _sum: { amountUgx: true },
      }),
      this.prisma.user.count({
        where: { createdAt: { gt: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) } },
      }),
    ]);

    return {
      userCount,
      activeSubscriptions,
      titleCount,
      publishedTitleCount,
      totalRevenueUgx: revenueResult._sum.amountUgx ?? 0,
      recentSignups7d: recentSignups,
    };
  }
}
