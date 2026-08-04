import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  UseGuards,
} from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { StaffGuard } from '../common/guards/staff.guard';

/**
 * Browse and manage files uploaded over SFTP and published to the public
 * media folder (see muza-publish-uploads.sh). Gives staff a copyable direct
 * URL for the "Import from a link" flow, plus a delete for tidying up.
 *
 * Deliberately StaffGuard rather than AdminGuard: the person uploading
 * content needs to clear their own staging files. This folder is an ingest
 * staging area, not published catalogue content — deleting a title still
 * requires an admin.
 */
@UseGuards(JwtAuthGuard, StaffGuard)
@Controller('admin/media-library')
export class MediaLibraryController {
  constructor(private readonly config: ConfigService) {}

  private get dir(): string {
    return this.config.get<string>('MEDIA_PUBLIC_DIR') ?? '/srv/muza-media';
  }

  /** Reject anything that isn't a plain filename (no traversal, no nesting). */
  private safeName(name: string): string {
    const base = path.basename(name);
    if (!base || base !== name || base.startsWith('.')) {
      throw new BadRequestException('Invalid file name.');
    }
    return base;
  }

  @Get()
  list() {
    const dir = this.dir;
    if (!fs.existsSync(dir)) return { files: [], dir };

    const files = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && !e.name.startsWith('.'))
      .map((e) => {
        const stat = fs.statSync(path.join(dir, e.name));
        return {
          name: e.name,
          sizeBytes: stat.size,
          modifiedAt: stat.mtime,
          url: `${this.config.get('PUBLIC_BASE_URL') ?? 'https://ham.sentepos.com'}/api/media/${encodeURIComponent(e.name)}`,
        };
      })
      .sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());

    return { files, dir };
  }

  @Delete(':name')
  remove(@Param('name') name: string) {
    const file = path.join(this.dir, this.safeName(name));
    if (!fs.existsSync(file)) throw new NotFoundException('File not found.');
    fs.unlinkSync(file);
    return { ok: true };
  }
}
