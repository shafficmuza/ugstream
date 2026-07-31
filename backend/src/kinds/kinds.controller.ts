import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AdminGuard } from '../common/guards/admin.guard';
import { StaffGuard } from '../common/guards/staff.guard';
import { CreateKindDto } from './dto/kind.dto';

/**
 * Title "kinds" (Movie, Series, Documentary, Music, …) as a runtime-managed
 * lookup table rather than a hardcoded enum, so admins can add their own.
 * `Title.kind` stores the kind's slug as a plain string — deleting a kind
 * that titles still reference is blocked to avoid orphaning those values.
 */
@Controller()
export class KindsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('kinds')
  list() {
    return this.prisma.kind.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
  }

  @UseGuards(JwtAuthGuard, StaffGuard)
  @Get('admin/kinds')
  async adminList() {
    const [kinds, grouped] = await Promise.all([
      this.prisma.kind.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
      this.prisma.title.groupBy({ by: ['kind'], _count: { _all: true } }),
    ]);
    const counts = new Map(grouped.map((g) => [g.kind, g._count._all]));
    return kinds.map((k) => ({ ...k, titleCount: counts.get(k.slug) ?? 0 }));
  }

  @UseGuards(JwtAuthGuard, StaffGuard)
  @Post('admin/kinds')
  create(@Body() body: CreateKindDto) {
    if (!body?.name?.trim() || !body?.slug?.trim()) {
      throw new BadRequestException('name and slug are required.');
    }
    return this.prisma.kind.create({
      data: { name: body.name.trim(), slug: body.slug.trim(), sortOrder: body.sortOrder ?? 0 },
    });
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Delete('admin/kinds/:id')
  async remove(@Param('id') id: string) {
    const kind = await this.prisma.kind.findUnique({ where: { id: Number(id) } });
    if (!kind) return { ok: true };
    const inUse = await this.prisma.title.count({ where: { kind: kind.slug } });
    if (inUse > 0) {
      throw new BadRequestException(
        `"${kind.name}" is used by ${inUse} title(s). Reassign them before deleting.`,
      );
    }
    await this.prisma.kind.delete({ where: { id: kind.id } });
    return { ok: true };
  }
}
