import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { TitlesService } from './titles.service';
import { OptionalJwtGuard } from '../common/guards/optional-jwt.guard';

/**
 * The public catalogue. Optionally authenticated: anonymous visitors and
 * ordinary accounts get the live catalogue, tester accounts get the test one.
 */
@UseGuards(OptionalJwtGuard)
@Controller()
export class TitlesController {
  constructor(private readonly titles: TitlesService) {}

  @Get('home')
  home(@Req() req: any) {
    return this.titles.home(req.auth);
  }

  /**
   * The test catalogue, regardless of who is asking.
   *
   * This backs the shareable tester link, so it has to work before the person
   * opening it has an account — asking them to sign in first to discover
   * whether they can see anything is a poor way to hand out a test build.
   * Browsing is all it grants: playback still needs a signed-in account that
   * is entitled, so the videos themselves are no less protected than any
   * other. The page is marked noindex so it stays unlisted rather than
   * turning up in search.
   */
  @Get('test-home')
  testHome() {
    return this.titles.home({ isTester: true });
  }

  @Get('test-titles')
  testBrowse(
    @Query('kind') kind?: string,
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('per_page') perPage?: string,
  ) {
    return this.titles.browse(
      {
        kind,
        q,
        page: page ? parseInt(page, 10) : undefined,
        perPage: perPage ? parseInt(perPage, 10) : undefined,
      },
      { isTester: true },
    );
  }

  @Get('titles')
  browse(
    @Req() req: any,
    @Query('kind') kind?: string,
    @Query('genre') genre?: string,
    @Query('language') language?: string,
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('per_page') perPage?: string,
  ) {
    return this.titles.browse(
      {
        kind,
        genre,
        language,
        q,
        page: page ? parseInt(page, 10) : undefined,
        perPage: perPage ? parseInt(perPage, 10) : undefined,
      },
      req.auth,
    );
  }

  @Get('titles/:slug')
  detail(@Req() req: any, @Param('slug') slug: string) {
    return this.titles.findBySlug(slug, req.auth);
  }

  @Get('titles/:slug/similar')
  similar(@Req() req: any, @Param('slug') slug: string) {
    return this.titles.similar(slug, req.auth);
  }
}
