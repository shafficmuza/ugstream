import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface BrowseQuery {
  kind?: 'movie' | 'series';
  genre?: string;
  language?: string;
  q?: string;
  page?: number;
  perPage?: number;
}

@Injectable()
export class TitlesService {
  constructor(private readonly prisma: PrismaService) {}

  async browse(query: BrowseQuery) {
    const page = Math.max(1, query.page ?? 1);
    const perPage = Math.min(50, Math.max(1, query.perPage ?? 20));

    const where: any = { published: true };
    if (query.kind) where.kind = query.kind;
    if (query.language) where.language = query.language;
    if (query.q) where.name = { contains: query.q, mode: 'insensitive' };
    if (query.genre) where.genres = { some: { genre: { slug: query.genre } } };

    const [items, total] = await Promise.all([
      this.prisma.title.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
        select: {
          id: true,
          slug: true,
          name: true,
          kind: true,
          posterUrl: true,
          access: true,
          priceUgx: true,
          releaseYear: true,
        },
      }),
      this.prisma.title.count({ where }),
    ]);

    return {
      items: items.map((t) => ({ ...t, id: t.id.toString() })),
      page,
      perPage,
      total,
      totalPages: Math.ceil(total / perPage),
    };
  }

  async findBySlug(slug: string) {
    const title = await this.prisma.title.findFirst({
      where: { slug, published: true },
      include: {
        episodes: { orderBy: [{ season: 'asc' }, { number: 'asc' }] },
        genres: { include: { genre: true } },
      },
    });
    if (!title) throw new NotFoundException('Title not found.');

    return {
      ...title,
      id: title.id.toString(),
      genres: title.genres.map((g) => g.genre.name),
      episodes: title.episodes.map((e) => ({
        ...e,
        id: e.id.toString(),
        titleId: e.titleId.toString(),
      })),
    };
  }

  async home() {
    const [newest, movies, series] = await Promise.all([
      this.prisma.title.findMany({
        where: { published: true },
        orderBy: { createdAt: 'desc' },
        take: 12,
      }),
      this.prisma.title.findMany({
        where: { published: true, kind: 'movie' },
        orderBy: { createdAt: 'desc' },
        take: 12,
      }),
      this.prisma.title.findMany({
        where: { published: true, kind: 'series' },
        orderBy: { createdAt: 'desc' },
        take: 12,
      }),
    ]);

    const serialize = (rows: any[]) =>
      rows.map((t) => ({
        id: t.id.toString(),
        slug: t.slug,
        name: t.name,
        posterUrl: t.posterUrl,
        access: t.access,
        priceUgx: t.priceUgx,
      }));

    return [
      { rail: 'New This Week', titles: serialize(newest) },
      { rail: 'Movies', titles: serialize(movies) },
      { rail: 'Series', titles: serialize(series) },
    ];
  }
}
