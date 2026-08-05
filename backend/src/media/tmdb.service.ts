import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { SecretsService } from '../common/secrets.service';

/**
 * Official artwork lookup via TMDB — the same source Plex/Jellyfin/Kodi use.
 *
 * Matching is deliberately NOT automatic: titles are ambiguous (several films
 * share a name, and VJ-style names often don't match at all), and silently
 * attaching the wrong film's poster is worse than attaching none. Staff pick
 * the correct film from the search results.
 *
 * Images are downloaded and re-served from our own uploads directory rather
 * than hotlinked, so artwork keeps working if TMDB is unreachable.
 *
 * Attribution required by TMDB's terms: "This product uses the TMDB API but
 * is not endorsed or certified by TMDB." — shown in the admin UI.
 */
@Injectable()
export class TmdbService {
  private readonly logger = new Logger(TmdbService.name);
  private static readonly IMG = 'https://image.tmdb.org/t/p';

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly secrets: SecretsService,
  ) {}

  async isConfigured(): Promise<boolean> {
    return this.secrets.isSet('TMDB_API_KEY');
  }

  private async key(): Promise<string> {
    const k = await this.secrets.get('TMDB_API_KEY');
    if (!k) {
      throw new BadRequestException(
        'TMDB is not configured — add TMDB_API_KEY in Settings first.',
      );
    }
    return k;
  }

  /** Search films (and TV) by name, newest/most relevant first. */
  async search(query: string, kind: string, year?: number) {
    if (!query?.trim()) throw new BadRequestException('Enter a title to search for.');
    const key = await this.key();
    const type = kind === 'series' ? 'tv' : 'movie';
    const url =
      `https://api.themoviedb.org/3/search/${type}?api_key=${key}` +
      `&query=${encodeURIComponent(query.trim())}` +
      (year ? `&${type === 'tv' ? 'first_air_date_year' : 'year'}=${year}` : '');

    const res = await fetch(url);
    if (!res.ok) throw new BadRequestException(`TMDB search failed (${res.status}).`);
    const data: any = await res.json();

    return {
      results: (data.results ?? [])
        .filter((r: any) => r.poster_path || r.backdrop_path)
        .slice(0, 12)
        .map((r: any) => ({
          tmdbId: r.id,
          type,
          name: r.title ?? r.name,
          year: (r.release_date ?? r.first_air_date ?? '').slice(0, 4) || null,
          overview: r.overview || null,
          // w342 is enough for a picker thumbnail; full size is fetched on apply.
          previewUrl: r.poster_path
            ? `${TmdbService.IMG}/w342${r.poster_path}`
            : `${TmdbService.IMG}/w300${r.backdrop_path}`,
          posterPath: r.poster_path,
          backdropPath: r.backdrop_path,
        })),
    };
  }

  /** Download a TMDB image into uploads/images and return its public path. */
  private async download(tmdbPath: string, size: string): Promise<string | null> {
    try {
      const res = await fetch(`${TmdbService.IMG}/${size}${tmdbPath}`);
      if (!res.ok) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 1000) return null;

      const dir = path.join(process.cwd(), 'uploads', 'images');
      fs.mkdirSync(dir, { recursive: true });
      const file = `${crypto.randomUUID()}.jpg`;
      fs.writeFileSync(path.join(dir, file), buf);

      const prefix = this.config.get<string>('PUBLIC_ASSET_PREFIX') ?? '';
      return `${prefix}/uploads/images/${file}`;
    } catch (e: any) {
      this.logger.warn(`TMDB image download failed: ${e.message}`);
      return null;
    }
  }

  /** Attach the chosen film's official poster + backdrop to a title. */
  async apply(titleId: bigint, posterPath?: string, backdropPath?: string) {
    if (!posterPath && !backdropPath) {
      throw new BadRequestException('That result has no artwork to use.');
    }
    const data: { posterUrl?: string; bannerUrl?: string } = {};
    if (posterPath) {
      const p = await this.download(posterPath, 'w780');
      if (p) data.posterUrl = p;
    }
    if (backdropPath) {
      const b = await this.download(backdropPath, 'w1280');
      if (b) data.bannerUrl = b;
    }
    if (!data.posterUrl && !data.bannerUrl) {
      throw new BadRequestException('Could not download the artwork from TMDB.');
    }

    const title = await this.prisma.title.update({ where: { id: titleId }, data });
    return { posterUrl: title.posterUrl, bannerUrl: title.bannerUrl };
  }
}
