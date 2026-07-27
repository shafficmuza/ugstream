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

  // --- Browser-direct 4K uploads to R2 (multipart presigned) --------------

  @UseGuards(AdminGuard)
  @Post('admin/r2/multipart/create')
  r2MultipartCreate(
    @Body() body: { filename: string; contentType: string; purpose: 'source' | 'final' },
  ) {
    return this.episodes.r2MultipartCreate(body.filename, body.contentType, body.purpose);
  }

  @UseGuards(AdminGuard)
  @Post('admin/r2/multipart/sign-part')
  r2MultipartSignPart(@Body() body: { key: string; uploadId: string; partNumber: number }) {
    return this.episodes.r2MultipartSignPart(body.key, body.uploadId, body.partNumber);
  }

  @UseGuards(AdminGuard)
  @Post('admin/r2/multipart/complete')
  r2MultipartComplete(
    @Body() body: { key: string; uploadId: string; parts: { PartNumber: number; ETag: string }[] },
  ) {
    return this.episodes.r2MultipartComplete(body.key, body.uploadId, body.parts);
  }

  @UseGuards(AdminGuard)
  @Post('admin/r2/multipart/abort')
  r2MultipartAbort(@Body() body: { key: string; uploadId: string }) {
    return this.episodes.r2MultipartAbort(body.key, body.uploadId);
  }

  /** Register an already-uploaded ready 4K file as a directly-served episode. */
  @UseGuards(AdminGuard)
  @Post('admin/titles/:titleId/episodes/register-r2-file')
  registerR2File(
    @Param('titleId') titleId: string,
    @Body() body: { key: string; name?: string; season?: number; number?: number },
  ) {
    return this.episodes.registerR2File(BigInt(titleId), body.key, {
      season: body.season,
      number: body.number,
      name: body.name,
    });
  }

  /** Transcode an already-uploaded R2 source into a 4K HLS ladder. */
  @UseGuards(AdminGuard)
  @Post('admin/titles/:titleId/episodes/transcode-4k-r2')
  transcode4kFromR2(
    @Param('titleId') titleId: string,
    @Body() body: { key: string; name?: string; season?: number; number?: number },
  ) {
    return this.episodes.transcode4kFromR2(BigInt(titleId), body.key, {
      season: body.season,
      number: body.number,
      name: body.name,
    });
  }

  /**
   * Self-hosted true-4K path: transcode a source URL into a 2160p HLS ladder
   * on R2 (Cloudflare Stream caps at 1080p). Returns immediately; the
   * episode reports `uploading` until the background transcode finishes.
   */
  @UseGuards(AdminGuard)
  @Post('admin/titles/:titleId/episodes/transcode-4k')
  transcode4k(
    @Param('titleId') titleId: string,
    @Body() body: { url: string; name?: string; season?: number; number?: number },
  ) {
    return this.episodes.transcode4k(BigInt(titleId), body.url, {
      season: body.season,
      number: body.number,
      name: body.name,
    });
  }
}
