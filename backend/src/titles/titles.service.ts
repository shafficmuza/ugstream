import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { Viewer, audienceWhere, audienceSql } from './audience';
import { readCatalogueMode } from './catalogue-mode';

export interface BrowseQuery {
  kind?: string;
  genre?: string;
  language?: string;
  q?: string;
  page?: number;
  perPage?: number;
}

@Injectable()
export class TitlesService {
  constructor(private readonly prisma: PrismaService) {}

  async browse(query: BrowseQuery, viewer?: Viewer | null) {
    const page = Math.max(1, query.page ?? 1);
    const perPage = Math.min(50, Math.max(1, query.perPage ?? 20));

    const where: any = { ...audienceWhere(viewer, await readCatalogueMode(this.prisma)) };
    if (query.kind) where.kind = query.kind;
    if (query.language) where.language = query.language;
    if (query.q) {
      // Netflix-style search: match title names, VJ names, and genre names —
      // "kids" or "vj junior" should find things, not just exact title text.
      where.OR = [
        { name: { contains: query.q, mode: 'insensitive' } },
        { vjName: { contains: query.q, mode: 'insensitive' } },
        { genres: { some: { genre: { name: { contains: query.q, mode: 'insensitive' } } } } },
      ];
    }
    if (query.genre) where.genres = { some: { genre: { slug: query.genre } } };

    const [items, total] = await Promise.all([
      this.prisma.title.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
        include: TitlesService.cardEpisodeInclude,
      }),
      this.prisma.title.count({ where }),
    ]);

    return {
      items: items.map((t) => this.toCard(t)),
      page,
      perPage,
      total,
      totalPages: Math.ceil(total / perPage),
    };
  }

  async findBySlug(slug: string, viewer?: Viewer | null) {
    const mode = await readCatalogueMode(this.prisma);
    const title = await this.prisma.title.findFirst({
      where: { slug, ...audienceWhere(viewer, mode) },
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

  /** Include fragment giving each title its first playable episode, so
   *  cards can deep-link straight to /watch/:episodeId (Netflix-style)
   *  without a second request. */
  static readonly cardEpisodeInclude = {
    episodes: {
      where: { cfStatus: 'ready' as const },
      orderBy: [{ season: 'asc' as const }, { number: 'asc' as const }],
      take: 1,
      select: { id: true },
    },
  };

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
      firstEpisodeId: t.episodes?.[0]?.id?.toString() ?? null,
    };
  }

  async home(viewer?: Viewer | null) {
    const mode = await readCatalogueMode(this.prisma);
    const audience = audienceWhere(viewer, mode);
    const [newest, movies, series, genres, topTitleIds] = await Promise.all([
      this.prisma.title.findMany({
        where: { ...audience },
        orderBy: { createdAt: 'desc' },
        take: 12,
        include: TitlesService.cardEpisodeInclude,
      }),
      this.prisma.title.findMany({
        where: { ...audience, kind: 'movie' },
        orderBy: { createdAt: 'desc' },
        take: 12,
        include: TitlesService.cardEpisodeInclude,
      }),
      this.prisma.title.findMany({
        where: { ...audience, kind: 'series' },
        orderBy: { createdAt: 'desc' },
        take: 12,
        include: TitlesService.cardEpisodeInclude,
      }),
      this.prisma.genre.findMany({
        where: { titles: { some: { title: { ...audience } } } },
        orderBy: { name: 'asc' },
      }),
      // Popularity = distinct viewers per title. Raw SQL because Prisma's
      // groupBy can't traverse watch_history -> episodes -> titles in one
      // aggregation.
      // The audience predicate has to be interpolated because this is raw SQL,
      // so it cannot share the helper's object form — but it must agree with
      // it. It did not, once: this rail kept `t.published = true` when every
      // other query moved to the helper, and testers were served live titles
      // in Top 10. The audience.spec regex now covers this shape too.
      this.prisma.$queryRaw<{ title_id: bigint; viewers: bigint }[]>`
        SELECT e.title_id, COUNT(DISTINCT wh.user_id) AS viewers
        FROM watch_history wh
        JOIN episodes e ON e.id = wh.episode_id
        JOIN titles t ON t.id = e.title_id
        WHERE ${Prisma.raw(audienceSql(viewer, mode))}
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
            where: { ...audience, genres: { some: { genreId: g.id } } },
            orderBy: { createdAt: 'desc' },
            take: 12,
            include: TitlesService.cardEpisodeInclude,
          })
        ).map((t) => this.toCard(t)),
      })),
    );

    let top10: any[] = [];
    if (topTitleIds.length > 0) {
      const ids = topTitleIds.map((r) => r.title_id);
      const rows = await this.prisma.title.findMany({
        // The ids already come from an audience-filtered query, so this is
        // belt and braces — but it means the rail cannot start leaking if
        // that SQL is ever edited, which is precisely how it leaked before.
        where: { ...audience, id: { in: ids } },
        include: TitlesService.cardEpisodeInclude,
      });
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
  async similar(slug: string, viewer?: Viewer | null) {
    const mode = await readCatalogueMode(this.prisma);
    const audience = audienceWhere(viewer, mode);
    const title = await this.prisma.title.findFirst({
      where: { slug, ...audienceWhere(viewer, mode) },
      include: { genres: true },
    });
    if (!title) throw new NotFoundException('Title not found.');

    const genreIds = title.genres.map((g) => g.genreId);
    const rows = await this.prisma.title.findMany({
      where: {
        ...audience,
        id: { not: title.id },
        ...(genreIds.length ? { genres: { some: { genreId: { in: genreIds } } } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 12,
      include: TitlesService.cardEpisodeInclude,
    });
    return rows.map((t) => this.toCard(t));
  }
}
