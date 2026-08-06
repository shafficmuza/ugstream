import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { EpisodesService } from './episodes.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AdminGuard } from '../common/guards/admin.guard';
import { StaffGuard } from '../common/guards/staff.guard';
import { CurrentUser, AuthContext } from '../common/decorators/current-user.decorator';
import { ActivityService } from '../common/activity.service';
import {
  SaveProgressDto,
  CreateEpisodeDto,
  ImportUrlDto,
  RegisterR2FileDto,
  RegisterR2HlsDto,
  TranscodeUrlDto,
  TranscodeR2Dto,
} from './dto/episode.dto';

@UseGuards(JwtAuthGuard)
@Controller()
export class EpisodesController {
  constructor(
    private readonly episodes: EpisodesService,
    private readonly activity: ActivityService,
  ) {}

  @Post('episodes/:id/play')
  play(@CurrentUser() auth: AuthContext, @Param('id') id: string) {
    return this.episodes.play(auth.userId, BigInt(id), auth.sessionId);
  }

  @Put('episodes/:id/progress')
  progress(
    @CurrentUser() auth: AuthContext,
    @Param('id') id: string,
    @Body() body: SaveProgressDto,
  ) {
    return this.episodes.saveProgress(
      auth.userId,
      BigInt(id),
      body.positionSecs,
      auth.sessionId,
    );
  }

  @Get('me/continue-watching')
  continueWatching(@CurrentUser() auth: AuthContext) {
    return this.episodes.continueWatching(auth.userId);
  }

  @UseGuards(StaffGuard)
  @Post('admin/titles/:titleId/episodes')
  async createEpisode(
    @CurrentUser() auth: AuthContext,
    @Param('titleId') titleId: string,
    @Body() body: CreateEpisodeDto,
  ) {
    const r = await this.episodes.createForTitle(BigInt(titleId), body);
    this.activity.log(auth.userId, 'video_added', 'Added a video (Cloudflare Stream upload)', BigInt(titleId));
    return r;
  }

  @UseGuards(StaffGuard)
  @Post('admin/titles/:titleId/episodes/:episodeId/upload-url')
  getUploadUrl(@Param('episodeId') episodeId: string) {
    return this.episodes.getUploadUrl(BigInt(episodeId));
  }

  @UseGuards(StaffGuard)
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

  @UseGuards(StaffGuard)
  @Post('admin/titles/:titleId/episodes/import-url')
  async importFromUrl(
    @CurrentUser() auth: AuthContext,
    @Param('titleId') titleId: string,
    @Body() body: ImportUrlDto,
  ) {
    const r = await this.episodes.importFromUrl(
      BigInt(titleId),
      body.url,
      body.name ?? 'Imported video',
      { season: body.season, number: body.number },
    );
    this.activity.log(auth.userId, 'video_imported', 'Imported a video from URL', BigInt(titleId));
    return r;
  }

  @UseGuards(AdminGuard)
  @Post('admin/stream/cleanup-orphans')
  cleanupOrphans() {
    return this.episodes.cleanupOrphans();
  }

  // --- Browser-direct 4K uploads to R2 (multipart presigned) --------------

  @UseGuards(StaffGuard)
  @Post('admin/r2/multipart/create')
  r2MultipartCreate(
    @Body() body: { filename: string; contentType: string; purpose: 'source' | 'final' },
  ) {
    return this.episodes.r2MultipartCreate(body.filename, body.contentType, body.purpose);
  }

  @UseGuards(StaffGuard)
  @Post('admin/r2/multipart/sign-part')
  r2MultipartSignPart(@Body() body: { key: string; uploadId: string; partNumber: number }) {
    return this.episodes.r2MultipartSignPart(body.key, body.uploadId, body.partNumber);
  }

  @UseGuards(StaffGuard)
  @Post('admin/r2/multipart/complete')
  r2MultipartComplete(
    @Body() body: { key: string; uploadId: string; parts: { PartNumber: number; ETag: string }[] },
  ) {
    return this.episodes.r2MultipartComplete(body.key, body.uploadId, body.parts);
  }

  @UseGuards(StaffGuard)
  @Post('admin/r2/multipart/abort')
  r2MultipartAbort(@Body() body: { key: string; uploadId: string }) {
    return this.episodes.r2MultipartAbort(body.key, body.uploadId);
  }

  /** Register an already-uploaded ready 4K file as a directly-served episode. */
  @UseGuards(StaffGuard)
  @Post('admin/titles/:titleId/episodes/register-r2-file')
  async registerR2File(
    @CurrentUser() auth: AuthContext,
    @Param('titleId') titleId: string,
    @Body() body: RegisterR2FileDto,
  ) {
    const r = await this.episodes.registerR2File(BigInt(titleId), body.key, {
      season: body.season,
      number: body.number,
      name: body.name,
    });
    this.activity.log(auth.userId, 'video_uploaded', 'Uploaded a ready 4K file (R2)', BigInt(titleId));
    return r;
  }

  /** Transcode an already-uploaded R2 source into a 4K HLS ladder. */
  @UseGuards(StaffGuard)
  @Post('admin/titles/:titleId/episodes/transcode-4k-r2')
  async transcode4kFromR2(
    @CurrentUser() auth: AuthContext,
    @Param('titleId') titleId: string,
    @Body() body: TranscodeR2Dto,
  ) {
    const r = await this.episodes.transcode4kFromR2(BigInt(titleId), body.key, {
      season: body.season,
      number: body.number,
      name: body.name,
    });
    this.activity.log(auth.userId, 'video_uploaded', 'Uploaded a source for 4K transcode (R2)', BigInt(titleId));
    return r;
  }

  // --- Pre-made HLS ladder upload (locally-encoded adaptive folder) --------

  /** Mint a fresh R2 prefix for one ladder upload. */
  @UseGuards(StaffGuard)
  @Post('admin/r2/hls/begin')
  hlsBegin() {
    return this.episodes.hlsBegin();
  }

  /** Presign a PUT for every file in the ladder folder. */
  @UseGuards(StaffGuard)
  @Post('admin/r2/hls/sign-batch')
  signHlsBatch(@Body() body: { prefix: string; files: { path: string }[] }) {
    return this.episodes.signHlsBatch(body.prefix, body.files);
  }

  /** Register the uploaded ladder as a ready adaptive episode. */
  @UseGuards(StaffGuard)
  @Post('admin/titles/:titleId/episodes/register-r2-hls')
  async registerR2Hls(
    @CurrentUser() auth: AuthContext,
    @Param('titleId') titleId: string,
    @Body() body: RegisterR2HlsDto,
  ) {
    const r = await this.episodes.registerR2Hls(BigInt(titleId), body.prefix, {
      season: body.season,
      number: body.number,
      name: body.name,
    });
    this.activity.log(auth.userId, 'video_uploaded', 'Uploaded a pre-made 4K HLS ladder (R2)', BigInt(titleId));
    return r;
  }

  /**
   * Self-hosted true-4K path: transcode a source URL into a 2160p HLS ladder
   * on R2 (Cloudflare Stream caps at 1080p). Returns immediately; the
   * episode reports `uploading` until the background transcode finishes.
   */
  @UseGuards(StaffGuard)
  @Post('admin/titles/:titleId/episodes/transcode-4k')
  async transcode4k(
    @CurrentUser() auth: AuthContext,
    @Param('titleId') titleId: string,
    @Body() body: TranscodeUrlDto,
  ) {
    const r = await this.episodes.transcode4k(BigInt(titleId), body.url, {
      season: body.season,
      number: body.number,
      name: body.name,
    });
    this.activity.log(auth.userId, 'video_transcode', 'Started a 4K transcode from URL', BigInt(titleId));
    return r;
  }
}
