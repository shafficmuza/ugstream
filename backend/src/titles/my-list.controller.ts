import { Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, AuthContext } from '../common/decorators/current-user.decorator';
import { TitlesService } from './titles.service';
import { audienceWhere } from './audience';

@UseGuards(JwtAuthGuard)
@Controller('me/my-list')
export class MyListController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@CurrentUser() auth: AuthContext) {
    const rows = await this.prisma.myListItem.findMany({
      // A tester's list shows test titles; everyone else's shows live ones.
      where: { userId: auth.userId, title: { ...audienceWhere(auth) } },
      orderBy: { createdAt: 'desc' },
      include: { title: { include: TitlesService.cardEpisodeInclude } },
    });
    return rows.map((r) => ({
      id: r.title.id.toString(),
      slug: r.title.slug,
      name: r.title.name,
      kind: r.title.kind,
      posterUrl: r.title.posterUrl,
      access: r.title.access,
      priceUgx: r.title.priceUgx,
      releaseYear: r.title.releaseYear,
      firstEpisodeId: r.title.episodes[0]?.id?.toString() ?? null,
      addedAt: r.createdAt,
    }));
  }

  @Post(':titleId')
  async add(@CurrentUser() auth: AuthContext, @Param('titleId') titleId: string) {
    await this.prisma.myListItem.upsert({
      where: { userId_titleId: { userId: auth.userId, titleId: BigInt(titleId) } },
      update: {},
      create: { userId: auth.userId, titleId: BigInt(titleId) },
    });
    return { inList: true };
  }

  @Delete(':titleId')
  async remove(@CurrentUser() auth: AuthContext, @Param('titleId') titleId: string) {
    await this.prisma.myListItem.deleteMany({
      where: { userId: auth.userId, titleId: BigInt(titleId) },
    });
    return { inList: false };
  }
}
