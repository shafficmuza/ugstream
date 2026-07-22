import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AdminGuard } from '../common/guards/admin.guard';

@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@Query('page') page?: string, @Query('per_page') perPage?: string, @Query('q') q?: string) {
    const pageNum = Math.max(1, parseInt(page ?? '1', 10) || 1);
    const perPageNum = Math.min(100, Math.max(1, parseInt(perPage ?? '30', 10) || 30));
    const where = q ? { phone: { contains: q } } : {};

    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (pageNum - 1) * perPageNum,
        take: perPageNum,
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      items: items.map((u) => ({ ...u, id: u.id.toString() })),
      page: pageNum,
      perPage: perPageNum,
      total,
      totalPages: Math.ceil(total / perPageNum),
    };
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() body: Partial<{ role: 'user' | 'admin'; status: 'active' | 'banned'; displayName: string }>,
  ) {
    const user = await this.prisma.user.update({ where: { id: BigInt(id) }, data: body });
    return { ...user, id: user.id.toString() };
  }
}
