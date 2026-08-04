import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { R2Service } from '../media-storage/r2.service';

/**
 * Generates poster/banner artwork from a title's own video, so staff don't
 * have to source images manually.
 *
 * Frames are sampled across the film (skipping opening titles and end
 * credits, where frames are usually black or text). Letterbox bars are
 * detected and removed before cropping — a naive crop bakes black bars into
 * the poster. Candidates are offered for a human to choose from rather than
 * auto-applied: a frame can be technically fine and still be a poor poster.
 */
@Injectable()
export class ArtworkService {
  private readonly logger = new Logger(ArtworkService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly r2: R2Service,
  ) {}

  private get imagesDir(): string {
    return path.join(process.cwd(), 'uploads', 'images');
  }

  private publicPath(file: string): string {
    const prefix = this.config.get<string>('PUBLIC_ASSET_PREFIX') ?? '';
    return `${prefix}/uploads/images/${file}`;
  }

  private run(cmd: string, args: string[], timeoutMs = 120_000): Promise<string> {
    return new Promise((resolve, reject) => {
      const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      let err = '';
      const timer = setTimeout(() => {
        p.kill('SIGKILL');
        reject(new Error(`${cmd} timed out`));
      }, timeoutMs);
      p.stdout.on('data', (d) => (out += d));
      p.stderr.on('data', (d) => (err += d.toString().slice(-4000)));
      p.on('close', (code) => {
        clearTimeout(timer);
        code === 0 ? resolve(out + err) : reject(new Error(err.slice(-400) || `${cmd} exited ${code}`));
      });
      p.on('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
    });
  }

  /** Where ffmpeg can read this episode's video from. */
  private async sourceFor(episode: {
    videoProvider: string;
    r2Prefix: string | null;
    cfVideoUid: string | null;
  }): Promise<{ kind: 'ffmpeg'; url: string } | { kind: 'cloudflare'; uid: string }> {
    if (episode.videoProvider === 'r2_hls' && episode.r2Prefix) {
      return { kind: 'ffmpeg', url: this.r2.publicUrl(`${episode.r2Prefix}master.m3u8`) };
    }
    if (episode.videoProvider === 'r2_file' && episode.r2Prefix) {
      return { kind: 'ffmpeg', url: this.r2.publicUrl(episode.r2Prefix) };
    }
    if (episode.cfVideoUid) return { kind: 'cloudflare', uid: episode.cfVideoUid };
    throw new BadRequestException('This video has no readable source yet.');
  }

  private async duration(url: string): Promise<number> {
    const out = await this.run('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1', url,
    ], 60_000);
    return parseFloat(out.trim()) || 0;
  }

  /**
   * Letterbox bars vary per film, so detect them rather than assume 16:9.
   * Returns an ffmpeg crop filter, or null when the frame is already full.
   */
  private async detectCrop(url: string, atSeconds: number): Promise<string | null> {
    try {
      const out = await this.run('ffmpeg', [
        '-hide_banner', '-ss', String(atSeconds), '-i', url,
        '-vframes', '6', '-vf', 'cropdetect=24:2:0', '-f', 'null', '-',
      ], 90_000);
      const matches = out.match(/crop=\d+:\d+:\d+:\d+/g);
      return matches?.length ? matches[matches.length - 1] : null;
    } catch {
      return null;
    }
  }

  /**
   * Sample candidate frames across the film. Returns public URLs for review.
   */
  async generateCandidates(titleId: bigint): Promise<{ candidates: string[] }> {
    const title = await this.prisma.title.findUniqueOrThrow({
      where: { id: titleId },
      include: { episodes: { orderBy: [{ season: 'asc' }, { number: 'asc' }] } },
    });
    const episode = title.episodes.find((e) => e.cfStatus === 'ready');
    if (!episode) throw new BadRequestException('No ready video to take frames from.');

    fs.mkdirSync(this.imagesDir, { recursive: true });
    const src = await this.sourceFor(episode);
    const stamp = crypto.randomUUID().slice(0, 8);
    const candidates: string[] = [];

    if (src.kind === 'cloudflare') {
      // Cloudflare serves frames directly — far cheaper than pulling the video.
      const code = this.config.get<string>('CLOUDFLARE_CUSTOMER_CODE');
      const total = episode.durationSecs ?? 0;
      const points = this.samplePoints(total || 3600);
      for (const [i, t] of points.entries()) {
        const url = `https://customer-${code}.cloudflarestream.com/${src.uid}/thumbnails/thumbnail.jpg?time=${t}s&width=1280`;
        const file = `cand-${stamp}-${i}.jpg`;
        try {
          const res = await fetch(url);
          if (!res.ok) continue;
          const buf = Buffer.from(await res.arrayBuffer());
          if (buf.length < 3000) continue; // near-empty/black frame
          fs.writeFileSync(path.join(this.imagesDir, file), buf);
          candidates.push(this.publicPath(file));
        } catch {
          /* skip this timestamp */
        }
      }
    } else {
      const total = episode.durationSecs ?? (await this.duration(src.url));
      const points = this.samplePoints(total);
      for (const [i, t] of points.entries()) {
        const file = `cand-${stamp}-${i}.jpg`;
        try {
          await this.run('ffmpeg', [
            '-hide_banner', '-loglevel', 'error', '-y',
            '-ss', String(t), '-i', src.url,
            '-frames:v', '1', '-vf', 'scale=1280:-2',
            path.join(this.imagesDir, file),
          ], 120_000);
          const stat = fs.statSync(path.join(this.imagesDir, file));
          if (stat.size < 3000) {
            fs.unlinkSync(path.join(this.imagesDir, file)); // black/blank frame
            continue;
          }
          candidates.push(this.publicPath(file));
        } catch (e: any) {
          this.logger.warn(`frame at ${t}s failed: ${e.message}`);
        }
      }
    }

    if (!candidates.length) {
      throw new BadRequestException('Could not read any frames from this video.');
    }
    return { candidates };
  }

  /** Evenly spaced points, skipping opening titles and end credits. */
  private samplePoints(total: number): number[] {
    const start = Math.max(60, total * 0.12);
    const end = Math.max(start + 60, total * 0.88);
    const n = 6;
    return Array.from({ length: n }, (_, i) => Math.round(start + ((end - start) * i) / (n - 1)));
  }

  /**
   * Turn a chosen candidate into a 2:3 poster and 16:9 banner, and attach
   * them to the title.
   */
  async applyCandidate(titleId: bigint, candidateUrl: string) {
    const file = path.basename(candidateUrl);
    if (!/^cand-[a-z0-9-]+\.jpg$/i.test(file)) throw new BadRequestException('Invalid candidate.');
    const srcPath = path.join(this.imagesDir, file);
    if (!fs.existsSync(srcPath)) throw new BadRequestException('Candidate has expired — regenerate.');

    const crop = await this.detectCrop(srcPath, 0);
    const base = crop ? `${crop},` : '';
    const posterFile = `${crypto.randomUUID()}.jpg`;
    const bannerFile = `${crypto.randomUUID()}.jpg`;

    // Poster: 2:3 portrait, centred. Banner: 16:9 wide.
    await this.run('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y', '-i', srcPath,
      '-vf', `${base}crop='min(iw,ih*2/3)':'min(ih,iw*3/2)',scale=1000:1500`,
      path.join(this.imagesDir, posterFile),
    ], 60_000);
    await this.run('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y', '-i', srcPath,
      '-vf', `${base}crop='min(iw,ih*16/9)':'min(ih,iw*9/16)',scale=1600:900`,
      path.join(this.imagesDir, bannerFile),
    ], 60_000);

    const title = await this.prisma.title.update({
      where: { id: titleId },
      data: { posterUrl: this.publicPath(posterFile), bannerUrl: this.publicPath(bannerFile) },
    });
    return { posterUrl: title.posterUrl, bannerUrl: title.bannerUrl };
  }
}
