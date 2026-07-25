import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { EpisodesService } from './episodes.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AdminGuard } from '../common/guards/admin.guard';
import { CurrentUser, AuthContext } from '../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller()
export class EpisodesController {
  constructor(private readonly episodes: EpisodesService) {}

  @Post('episodes/:id/play')
  play(@CurrentUser() auth: AuthContext, @Param('id') id: string) {
    return this.episodes.play(auth.userId, BigInt(id));
  }

  @Put('episodes/:id/progress')
  progress(
    @CurrentUser() auth: AuthContext,
    @Param('id') id: string,
    @Body() body: { positionSecs: number },
  ) {
    return this.episodes.saveProgress(auth.userId, BigInt(id), body.positionSecs);
  }

  @Get('me/continue-watching')
  continueWatching(@CurrentUser() auth: AuthContext) {
    return this.episodes.continueWatching(auth.userId);
  }

  @UseGuards(AdminGuard)
  @Post('admin/titles/:titleId/episodes')
  createEpisode(
    @Param('titleId') titleId: string,
    @Body() body: { season?: number; number?: number; name?: string },
  ) {
    return this.episodes.createForTitle(BigInt(titleId), body);
  }

  @UseGuards(AdminGuard)
  @Post('admin/titles/:titleId/episodes/:episodeId/upload-url')
  getUploadUrl(@Param('episodeId') episodeId: string) {
    return this.episodes.getUploadUrl(BigInt(episodeId));
  }

  @UseGuards(AdminGuard)
  @Post('admin/titles/:titleId/episodes/:episodeId/tus-upload')
  getTusUploadUrl(
    @Param('episodeId') episodeId: string,
    @Body() body: { uploadLength: number; filename?: string },
  ) {
    return this.episodes.getTusUploadUrl(
      BigInt(episodeId),
      body.uploadLength,
      body.filename ?? 'video',
    );
  }

  @UseGuards(AdminGuard)
  @Post('admin/titles/:titleId/episodes/import-url')
  importFromUrl(
    @Param('titleId') titleId: string,
    @Body() body: { url: string; name?: string; season?: number; number?: number },
  ) {
    return this.episodes.importFromUrl(
      BigInt(titleId),
      body.url,
      body.name ?? 'Imported video',
      { season: body.season, number: body.number },
    );
  }

  @UseGuards(AdminGuard)
  @Post('admin/stream/cleanup-orphans')
  cleanupOrphans() {
    return this.episodes.cleanupOrphans();
  }
}
