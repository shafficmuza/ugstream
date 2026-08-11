import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

const exec = promisify(execFile);

export interface FrameScore {
  timeSecs: number;
  bytes: number;
  brightness: number;
  score: number;
  rejected?: string;
}

/**
 * Chooses which moment of a video becomes its thumbnail.
 *
 * Cloudflare's own default is a fixed early frame, which in practice is
 * routinely a fade-in or a studio card — one measured episode's default still
 * was 1.1 KB, about a fifteenth the weight of any real scene, i.e. essentially
 * blank. So candidates are sampled across the runtime and scored.
 *
 * Two signals, because either alone picks badly:
 *
 *   - JPEG SIZE stands in for how much is going on in the frame. A flat or
 *     dark frame compresses to almost nothing; a busy one does not. No decode
 *     needed, which is why it is the primary signal.
 *   - BRIGHTNESS rejects what size alone loves. End credits are dark with
 *     dense white text, so they compress LARGE and would otherwise win outright
 *     — measured at 10/255 mean against 60–107 for real scenes. A darkness
 *     floor removes them, fades and black frames in one rule.
 *
 * Brightness comes from ffprobe's signalstats, already a dependency of the
 * transcode pipeline, rather than adding an image library.
 */
@Injectable()
export class ThumbnailPickerService {
  private readonly logger = new Logger(ThumbnailPickerService.name);

  /** Below this mean luminance (0–255) a frame is a fade, a black frame or credits. */
  private static readonly MIN_BRIGHTNESS = 28;
  /** Above this it is likely a white flash or a blown-out title card. */
  private static readonly MAX_BRIGHTNESS = 225;
  private static readonly SAMPLES = 9;
  /** Skip the opening logos and the very end, where nothing useful lives. */
  private static readonly START_PCT = 0.08;
  private static readonly END_PCT = 0.95;

  /**
   * Sample the runtime and return every candidate, best first. The caller
   * decides what to do with the winner; returning them all makes the choice
   * reviewable rather than a black box.
   */
  async pickBestFrame(
    urlForTime: (timeSecs: number) => string,
    durationSecs: number,
  ): Promise<{ best: FrameScore | null; candidates: FrameScore[] }> {
    if (!durationSecs || durationSecs < 5) return { best: null, candidates: [] };

    const span = durationSecs * (ThumbnailPickerService.END_PCT - ThumbnailPickerService.START_PCT);
    const step = span / (ThumbnailPickerService.SAMPLES - 1);
    const times = Array.from({ length: ThumbnailPickerService.SAMPLES }, (_, i) =>
      Math.round(durationSecs * ThumbnailPickerService.START_PCT + i * step),
    );

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'thumbpick-'));
    try {
      const candidates: FrameScore[] = [];
      for (const timeSecs of times) {
        const scored = await this.scoreFrame(urlForTime(timeSecs), timeSecs, dir).catch((e) => {
          this.logger.warn(`Frame at ${timeSecs}s could not be scored: ${e.message}`);
          return null;
        });
        if (scored) candidates.push(scored);
      }

      const usable = candidates.filter((c) => !c.rejected);
      usable.sort((a, b) => b.score - a.score);
      // Everything rejected (a very dark episode throughout) still deserves a
      // thumbnail, so fall back to the brightest frame rather than none.
      const best =
        usable[0] ??
        [...candidates].sort((a, b) => b.brightness - a.brightness)[0] ??
        null;
      return { best, candidates };
    } finally {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async scoreFrame(url: string, timeSecs: number, dir: string): Promise<FrameScore> {
    const file = path.join(dir, `f${timeSecs}.jpg`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`thumbnail fetch ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    await fs.writeFile(file, bytes);

    const brightness = await this.meanLuminance(file);
    const frame: FrameScore = { timeSecs, bytes: bytes.length, brightness, score: 0 };

    if (brightness < ThumbnailPickerService.MIN_BRIGHTNESS) {
      frame.rejected = 'too dark (fade, black frame or credits)';
      return frame;
    }
    if (brightness > ThumbnailPickerService.MAX_BRIGHTNESS) {
      frame.rejected = 'blown out';
      return frame;
    }
    // Detail carries the ranking; brightness only has to be reasonable, so it
    // contributes a mild preference for well-lit frames over murky ones rather
    // than competing with detail.
    frame.score = bytes.length * (0.75 + Math.min(brightness, 160) / 640);
    return frame;
  }

  /** Mean luminance 0–255, via the signalstats filter. */
  private async meanLuminance(file: string): Promise<number> {
    const { stdout } = await exec('ffprobe', [
      '-v', 'error',
      '-f', 'lavfi',
      '-i', `movie=${file.replace(/\\/g, '/').replace(/:/g, '\\:')},signalstats`,
      '-show_entries', 'frame_tags=lavfi.signalstats.YAVG',
      '-of', 'csv=p=0',
    ]);
    const value = Number(stdout.split('\n')[0]?.trim());
    return Number.isFinite(value) ? value : 0;
  }
}
