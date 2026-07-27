import {
  BadRequestException,
  Controller,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { diskStorage } from 'multer';
import * as crypto from 'crypto';
import * as path from 'path';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { StaffGuard } from '../common/guards/staff.guard';

const IMAGE_DIR = path.join(process.cwd(), 'uploads', 'images');
const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp']);

/**
 * Generic image upload for admin-authored content (poster/banner art).
 * Separate from the settings logo endpoint since this doesn't touch
 * AppSettings — it just returns a URL for the caller to store wherever
 * it belongs (e.g. titles.posterUrl).
 */
@UseGuards(JwtAuthGuard, StaffGuard)
@Controller('admin/media')
export class MediaController {
  constructor(private readonly config: ConfigService) {}

  @Post('image')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: IMAGE_DIR,
        filename: (_req, file, cb) => {
          const ext = path.extname(file.originalname).toLowerCase();
          cb(null, `${crypto.randomUUID()}${ext}`);
        },
      }),
      limits: { fileSize: 5 * 1024 * 1024 }, // 5MB — posters/banners, not source video
      fileFilter: (_req, file, cb) => {
        if (!ALLOWED_MIME.has(file.mimetype)) {
          cb(new BadRequestException('Image must be PNG, JPEG, or WebP.'), false);
          return;
        }
        cb(null, true);
      },
    }),
  )
  async upload(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file uploaded.');
    const prefix = this.config.get<string>('PUBLIC_ASSET_PREFIX') ?? '';
    return { url: `${prefix}/uploads/images/${file.filename}` };
  }
}
