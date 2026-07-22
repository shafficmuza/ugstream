import { Controller, Get, Param, Query } from '@nestjs/common';
import { TitlesService } from './titles.service';

@Controller()
export class TitlesController {
  constructor(private readonly titles: TitlesService) {}

  @Get('home')
  home() {
    return this.titles.home();
  }

  @Get('titles')
  browse(
    @Query('kind') kind?: 'movie' | 'series',
    @Query('genre') genre?: string,
    @Query('language') language?: string,
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('per_page') perPage?: string,
  ) {
    return this.titles.browse({
      kind,
      genre,
      language,
      q,
      page: page ? parseInt(page, 10) : undefined,
      perPage: perPage ? parseInt(perPage, 10) : undefined,
    });
  }

  @Get('titles/:slug')
  detail(@Param('slug') slug: string) {
    return this.titles.findBySlug(slug);
  }
}
