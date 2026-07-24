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

  private toCard(t: any) {
    return {
      id: t.id.toString(),
      slug: t.slug,
      name: t.name,
      kind: t.kind,
      posterUrl: t.posterUrl,
      access: t.access,
      priceUgx: t.priceUgx,
      releaseYear: t.releaseYear,
    };
  }

  async home() {
    const [newest, movies, series, genres, topTitleIds] = await Promise.all([
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
      this.prisma.genre.findMany({
        where: { titles: { some: { title: { published: true } } } },
        orderBy: { name: 'asc' },
      }),
      // Popularity = distinct viewers per title. Raw SQL because Prisma's
      // groupBy can't traverse watch_history -> episodes -> titles in one
      // aggregation.
      this.prisma.$queryRaw<{ title_id: bigint; viewers: bigint }[]>`
        SELECT e.title_id, COUNT(DISTINCT wh.user_id) AS viewers
        FROM watch_history wh
        JOIN episodes e ON e.id = wh.episode_id
        JOIN titles t ON t.id = e.title_id
        WHERE t.published = true
        GROUP BY e.title_id
        ORDER BY viewers DESC
        LIMIT 10
      `,
    ]);

    // Billboard: newest published title that has any artwork to show.
    const billboardTitle = newest.find((t) => t.bannerUrl || t.posterUrl) ?? newest[0] ?? null;
    const billboard = billboardTitle
      ? {
          ...this.toCard(billboardTitle),
          description: billboardTitle.description,
          bannerUrl: billboardTitle.bannerUrl,
        }
      : null;

    const genreRails = await Promise.all(
      genres.map(async (g) => ({
        key: `genre-${g.slug}`,
        rail: g.name,
        titles: (
          await this.prisma.title.findMany({
            where: { published: true, genres: { some: { genreId: g.id } } },
            orderBy: { createdAt: 'desc' },
            take: 12,
          })
        ).map((t) => this.toCard(t)),
      })),
    );

    let top10: any[] = [];
    if (topTitleIds.length > 0) {
      const ids = topTitleIds.map((r) => r.title_id);
      const rows = await this.prisma.title.findMany({ where: { id: { in: ids } } });
      const byId = new Map(rows.map((t) => [t.id.toString(), t]));
      top10 = ids
        .map((id) => byId.get(id.toString()))
        .filter(Boolean)
        .map((t) => this.toCard(t));
    }

    const rails = [
      { key: 'new', rail: 'New This Week', titles: newest.map((t) => this.toCard(t)) },
      ...(top10.length >= 3 ? [{ key: 'top10', rail: 'Top 10 Today', titles: top10 }] : []),
      { key: 'movies', rail: 'Movies', titles: movies.map((t) => this.toCard(t)) },
      { key: 'series', rail: 'Series', titles: series.map((t) => this.toCard(t)) },
      ...genreRails,
    ].filter((r) => r.titles.length > 0);

    return { billboard, rails };
  }

  /** Titles sharing at least one genre — "More Like This". Falls back to
   *  newest published titles when the source title has no genres. */
  async similar(slug: string) {
    const title = await this.prisma.title.findFirst({
      where: { slug, published: true },
      include: { genres: true },
    });
    if (!title) throw new NotFoundException('Title not found.');

    const genreIds = title.genres.map((g) => g.genreId);
    const rows = await this.prisma.title.findMany({
      where: {
        published: true,
        id: { not: title.id },
        ...(genreIds.length ? { genres: { some: { genreId: { in: genreIds } } } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 12,
    });
    return rows.map((t) => this.toCard(t));
  }
}
