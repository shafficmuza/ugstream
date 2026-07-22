import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AdminGuard } from '../common/guards/admin.guard';
import { UpsertTitleDto } from './dto/upsert-title.dto';

@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/titles')
export class AdminTitlesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list() {
    const titles = await this.prisma.title.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { episodes: true } } },
    });
    return titles.map((t) => ({
      ...t,
      id: t.id.toString(),
      episodeCount: t._count.episodes,
      _count: undefined,
    }));
  }

  @Get(':id')
  async detail(@Param('id') id: string) {
    const title = await this.prisma.title.findUniqueOrThrow({
      where: { id: BigInt(id) },
      include: {
        episodes: { orderBy: [{ season: 'asc' }, { number: 'asc' }] },
        genres: { include: { genre: true } },
      },
    });
    return {
      ...title,
      id: title.id.toString(),
      genreIds: title.genres.map((g) => g.genreId),
      genres: title.genres.map((g) => g.genre),
      episodes: title.episodes.map((e) => ({
        ...e,
        id: e.id.toString(),
        titleId: e.titleId.toString(),
      })),
    };
  }

  @Post()
  async create(@Body() dto: UpsertTitleDto) {
    const { genreIds, ...data } = dto;
    const title = await this.prisma.title.create({
      data: {
        ...data,
        genres: genreIds?.length
          ? { create: genreIds.map((genreId) => ({ genreId })) }
          : undefined,
      },
    });
    return { ...title, id: title.id.toString() };
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: Partial<UpsertTitleDto>) {
    const { genreIds, ...data } = dto;
    const title = await this.prisma.title.update({
      where: { id: BigInt(id) },
      data: {
        ...data,
        ...(genreIds
          ? {
              genres: {
                deleteMany: {},
                create: genreIds.map((genreId) => ({ genreId })),
              },
            }
          : {}),
      },
    });
    return { ...title, id: title.id.toString() };
  }

  @Patch(':id/publish')
  async publish(@Param('id') id: string, @Body() body: { published: boolean }) {
    const title = await this.prisma.title.update({
      where: { id: BigInt(id) },
      data: { published: body.published },
    });
    return { ...title, id: title.id.toString() };
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.prisma.title.delete({ where: { id: BigInt(id) } });
    return { ok: true };
  }
}
