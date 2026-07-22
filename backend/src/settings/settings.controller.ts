import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Patch,
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
import { SettingsService } from './settings.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AdminGuard } from '../common/guards/admin.guard';
import { UpdateSettingsDto } from './dto/update-settings.dto';

const LOGO_DIR = path.join(process.cwd(), 'uploads', 'logos');
const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']);

@Controller()
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly config: ConfigService,
  ) {}

  @Get('settings')
  get() {
    return this.settings.get();
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Patch('admin/settings')
  update(@Body() dto: UpdateSettingsDto) {
    return this.settings.update(dto);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Post('admin/settings/logo')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: LOGO_DIR,
        filename: (_req, file, cb) => {
          const ext = path.extname(file.originalname).toLowerCase();
          cb(null, `${crypto.randomUUID()}${ext}`);
        },
      }),
      limits: { fileSize: 2 * 1024 * 1024 }, // 2MB — this is a logo, not a poster
      fileFilter: (_req, file, cb) => {
        if (!ALLOWED_MIME.has(file.mimetype)) {
          cb(new BadRequestException('Logo must be PNG, JPEG, WebP, or SVG.'), false);
          return;
        }
        cb(null, true);
      },
    }),
  )
  async uploadLogo(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file uploaded.');
    // PUBLIC_ASSET_PREFIX is "/api" in production (Apache proxies /api/ to
    // this backend) and "" for local dev (backend served directly, no
    // proxy prefix) — see backend/.env.example.
    const prefix = this.config.get<string>('PUBLIC_ASSET_PREFIX') ?? '';
    const logoUrl = `${prefix}/uploads/logos/${file.filename}`;
    await this.settings.update({ logoUrl });
    return { logoUrl };
  }
}
