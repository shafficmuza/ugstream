import { Controller, Get, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { EpisodesService } from './episodes.service';

/**
 * An episode still, at a URL that keeps working.
 *
 * Deliberately its own controller, with no guard: these are rendered by plain
 * `<img>` tags on the public title page and in the apps, and an image request
 * carries no Authorization header. The video itself stays protected — this
 * only ever redirects to a still frame.
 *
 * It exists because Cloudflare signs thumbnails as well as playback for
 * videos created with requireSignedURLs, so the URL Cloudflare reports in its
 * API answers 401. Storing that left every episode a broken image. Signing on
 * demand behind a stable path means the stored link never expires, and no row
 * has to be rewritten when a token does.
 */
@Controller('episodes')
export class EpisodeThumbnailController {
  constructor(private readonly episodes: EpisodesService) {}

  @Get(':id/thumbnail')
  async thumbnail(@Param('id') id: string, @Res() res: Response) {
    const url = await this.episodes.signedThumbnailUrl(BigInt(id)).catch(() => null);
    if (!url) {
      // No frame to show yet (still encoding, or self-hosted on R2). 404 lets
      // the client fall back to the poster rather than showing a broken image.
      res.status(404).send('No thumbnail for this episode.');
      return;
    }
    // Short cache: the signed URL behind it is good for an hour, and an admin
    // re-picking the frame should show through quickly.
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.redirect(302, url);
  }
}
