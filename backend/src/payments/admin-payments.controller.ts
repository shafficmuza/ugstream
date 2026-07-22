import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AdminGuard } from '../common/guards/admin.guard';

@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/payments')
export class AdminPaymentsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@Query('page') page?: string, @Query('per_page') perPage?: string) {
    const pageNum = Math.max(1, parseInt(page ?? '1', 10) || 1);
    const perPageNum = Math.min(100, Math.max(1, parseInt(perPage ?? '30', 10) || 30));

    const [items, total] = await Promise.all([
      this.prisma.payment.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (pageNum - 1) * perPageNum,
        take: perPageNum,
        include: { user: { select: { phone: true } }, plan: { select: { name: true } } },
      }),
      this.prisma.payment.count(),
    ]);

    return {
      items: items.map((p) => ({
        id: p.id.toString(),
        userPhone: p.user.phone,
        amountUgx: p.amountUgx,
        purpose: p.purpose,
        planName: p.plan?.name ?? null,
        titleId: p.titleId?.toString() ?? null,
        provider: p.provider,
        status: p.status,
        createdAt: p.createdAt,
        confirmedAt: p.confirmedAt,
      })),
      page: pageNum,
      perPage: perPageNum,
      total,
      totalPages: Math.ceil(total / perPageNum),
    };
  }
}
