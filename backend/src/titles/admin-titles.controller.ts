import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AdminGuard } from '../common/guards/admin.guard';
import { StaffGuard } from '../common/guards/staff.guard';
import { UpsertTitleDto } from './dto/upsert-title.dto';
import { PublishTitleDto } from './dto/publish-title.dto';
import { EpisodesService } from '../episodes/episodes.service';
import { ActivityService } from '../common/activity.service';
import { CurrentUser, AuthContext } from '../common/decorators/current-user.decorator';

// Staff (admin OR editor) can list/create/edit/publish. Delete stacks
// AdminGuard on top (all guards must pass) so it stays admin-only.
@UseGuards(JwtAuthGuard, StaffGuard)
@Controller('admin/titles')
export class AdminTitlesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly episodes: EpisodesService,
    private readonly activity: ActivityService,
  ) {}

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

    // Self-heal any episode still 'uploading'/'pending' — the admin
    // checking on a title's upload progress is exactly the moment a
    // stuck-but-actually-ready status (missed webhook) would otherwise go
    // unnoticed. See EpisodesService.syncStatus.
    const episodes = await Promise.all(title.episodes.map((e) => this.episodes.syncStatus(e)));

    return {
      ...title,
      id: title.id.toString(),
      genreIds: title.genres.map((g) => g.genreId),
      genres: title.genres.map((g) => g.genre),
      episodes: episodes.map((e) => ({
        ...e,
        id: e.id.toString(),
        titleId: e.titleId.toString(),
      })),
    };
  }

  @Post()
  async create(@CurrentUser() auth: AuthContext, @Body() dto: UpsertTitleDto) {
    const { genreIds, ...data } = dto;
    const title = await this.prisma.title.create({
      data: {
        ...data,
        genres: genreIds?.length
          ? { create: genreIds.map((genreId) => ({ genreId })) }
          : undefined,
      },
    });
    this.activity.log(auth.userId, 'title_created', `Created title "${title.name}"`, title.id);
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
  async publish(@Param('id') id: string, @Body() body: PublishTitleDto) {
    const title = await this.prisma.title.update({
      where: { id: BigInt(id) },
      data: { published: body.published },
    });
    return { ...title, id: title.id.toString() };
  }

  @UseGuards(AdminGuard) // admin-only: delete
  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.prisma.title.delete({ where: { id: BigInt(id) } });
    return { ok: true };
  }
}
