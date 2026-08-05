import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { ArtworkService } from './artwork.service';
import { TmdbService } from './tmdb.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { StaffGuard } from '../common/guards/staff.guard';

/** Generate poster/banner artwork from a title's own video. */
@UseGuards(JwtAuthGuard, StaffGuard)
@Controller('admin/titles/:id/artwork')
export class ArtworkController {
  constructor(
    private readonly artwork: ArtworkService,
    private readonly tmdb: TmdbService,
  ) {}

  /** Search TMDB for the official artwork of this title. */
  @Post('tmdb-search')
  tmdbSearch(@Body() body: { query: string; kind?: string; year?: number }) {
    return this.tmdb.search(body.query, body.kind ?? 'movie', body.year);
  }

  /** Attach the chosen TMDB result's official poster + backdrop. */
  @Post('tmdb-apply')
  tmdbApply(
    @Param('id') id: string,
    @Body() body: { posterPath?: string; backdropPath?: string },
  ) {
    return this.tmdb.apply(BigInt(id), body.posterPath, body.backdropPath);
  }

  /** Sample candidate frames for a human to choose from. */
  @Post('candidates')
  candidates(@Param('id') id: string) {
    return this.artwork.generateCandidates(BigInt(id));
  }

  /** Turn the chosen frame into a poster + banner and attach them. */
  @Post('apply')
  apply(@Param('id') id: string, @Body() body: { candidate: string }) {
    return this.artwork.applyCandidate(BigInt(id), body.candidate);
  }
}
