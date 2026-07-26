import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';
import { mkdtemp, rm, readdir, stat } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { R2Service } from '../media-storage/r2.service';

/**
 * One rung of the adaptive ladder. H.264 High profile everywhere (universal
 * browser support via hls.js, including 4K). HEVC/AV1 would be more
 * bandwidth-efficient but need per-browser fallbacks — a later optimisation.
 */
interface Rung {
  height: number;
  vbitrate: string;
  abitrate: string;
  name: string;
}

// Netflix-style ladder topping out at true 2160p (4K).
const LADDER: Rung[] = [
  { height: 2160, vbitrate: '16000k', abitrate: '192k', name: '2160p' },
  { height: 1080, vbitrate: '6000k', abitrate: '128k', name: '1080p' },
  { height: 720, vbitrate: '3000k', abitrate: '128k', name: '720p' },
  { height: 480, vbitrate: '1200k', abitrate: '96k', name: '480p' },
];

@Injectable()
export class TranscodeService {
  private readonly logger = new Logger(TranscodeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly r2: R2Service,
  ) {}

  /**
   * Fire-and-forget: transcode a source URL into a 4K HLS ladder and upload
   * it to R2 under the episode's prefix, updating status as it goes. Rungs
   * above the source resolution are skipped by ffmpeg's scale (never
   * upscales). Long-running — invoked detached from the request.
   */
  startTranscode(episodeId: bigint, sourceUrl: string): void {
    this.runTranscode(episodeId, sourceUrl).catch((err) => {
      this.logger.error(`Transcode failed for episode ${episodeId}: ${err?.message ?? err}`);
      this.prisma.episode
        .update({ where: { id: episodeId }, data: { cfStatus: 'error' } })
        .catch(() => undefined);
    });
  }

  private async runTranscode(episodeId: bigint, sourceUrl: string): Promise<void> {
    const prefix = `hls/ep-${episodeId}/`;
    const workDir = await mkdtemp(join(tmpdir(), `hls-${episodeId}-`));
    this.logger.log(`Transcoding episode ${episodeId} → ${workDir}`);

    try {
      const durationSecs = await this.probeDuration(sourceUrl);
      await this.ffmpegLadder(sourceUrl, workDir);
      await this.uploadTree(workDir, prefix);

      await this.prisma.episode.update({
        where: { id: episodeId },
        data: { cfStatus: 'ready', durationSecs: Math.round(durationSecs), r2Prefix: prefix },
      });
      this.logger.log(`Episode ${episodeId} ready (4K HLS on R2, ${prefix})`);
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private probeDuration(sourceUrl: string): Promise<number> {
    return new Promise((resolve) => {
      const p = spawn('ffprobe', [
        '-v', 'error', '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1', sourceUrl,
      ]);
      let out = '';
      p.stdout.on('data', (d) => (out += d));
      p.on('close', () => resolve(parseFloat(out.trim()) || 0));
      p.on('error', () => resolve(0));
    });
  }

  /**
   * Single ffmpeg invocation producing every rung + a master.m3u8. Uses
   * `-var_stream_map` so ffmpeg writes one variant playlist per rung and the
   * master that references them. `force_original_aspect_ratio=decrease` plus
   * the min() guard means a 1080p source yields only ≤1080p rungs (no
   * upscaling waste).
   */
  private ffmpegLadder(sourceUrl: string, workDir: string): Promise<void> {
    const args: string[] = ['-hide_banner', '-y', '-i', sourceUrl];

    // Split the input into N scaled outputs. `scale=w=-2:h=min(ih,H)` keeps
    // the aspect ratio, forces an even width, and — crucially — never
    // upscales: a 1080p source clamps the 2160 rung to 1080 rather than
    // blowing it up. (Combining `-2` with force_original_aspect_ratio breaks
    // the encoder, so min() is the correct idiom here.)
    const splits = LADDER.map((_, i) => `[v${i}]`).join('');
    let filter = `[0:v]split=${LADDER.length}${splits}`;
    LADDER.forEach((r, i) => {
      filter += `;[v${i}]scale=w=-2:h=min(ih\\,${r.height})[vout${i}]`;
    });
    args.push('-filter_complex', filter);

    LADDER.forEach((r, i) => {
      args.push(
        '-map', `[vout${i}]`, '-map', '0:a:0?',
        `-c:v:${i}`, 'libx264', '-preset', 'veryfast', '-profile:v', 'high',
        `-b:v:${i}`, r.vbitrate, `-maxrate:v:${i}`, r.vbitrate,
        `-bufsize:v:${i}`, `${parseInt(r.vbitrate) * 2}k`,
        `-c:a:${i}`, 'aac', `-b:a:${i}`, r.abitrate,
      );
    });

    args.push(
      '-g', '48', '-keyint_min', '48', '-sc_threshold', '0',
      '-var_stream_map', LADDER.map((_, i) => `v:${i},a:${i}`).join(' '),
      '-master_pl_name', 'master.m3u8',
      '-f', 'hls', '-hls_time', '6', '-hls_playlist_type', 'vod',
      '-hls_segment_filename', join(workDir, 'stream_%v/seg_%03d.ts'),
      join(workDir, 'stream_%v/playlist.m3u8'),
    );

    return new Promise((resolve, reject) => {
      const p = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
      let err = '';
      p.stderr.on('data', (d) => (err += d.toString().slice(-2000)));
      p.on('close', (code) =>
        code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${err.slice(-500)}`)),
      );
      p.on('error', reject);
    });
  }

  /** Recursively upload the HLS tree to R2 with correct content types. */
  private async uploadTree(dir: string, prefix: string, sub = ''): Promise<void> {
    const entries = await readdir(join(dir, sub), { withFileTypes: true });
    for (const e of entries) {
      const rel = sub ? `${sub}/${e.name}` : e.name;
      if (e.isDirectory()) {
        await this.uploadTree(dir, prefix, rel);
      } else {
        const ct = e.name.endsWith('.m3u8')
          ? 'application/vnd.apple.mpegurl'
          : 'video/mp2t';
        await this.r2.putFile(`${prefix}${rel}`, join(dir, rel), ct);
      }
    }
  }
}
