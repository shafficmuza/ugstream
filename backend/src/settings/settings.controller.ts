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
import { SecretsService } from '../common/secrets.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';

const LOGO_DIR = path.join(process.cwd(), 'uploads', 'logos');
const BACKGROUND_DIR = path.join(process.cwd(), 'uploads', 'backgrounds');
const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']);

function imageUpload(destination: string, maxSizeBytes: number) {
  return FileInterceptor('file', {
    storage: diskStorage({
      destination,
      filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, `${crypto.randomUUID()}${ext}`);
      },
    }),
    limits: { fileSize: maxSizeBytes },
    fileFilter: (_req, file, cb) => {
      if (!ALLOWED_MIME.has(file.mimetype)) {
        cb(new BadRequestException('Image must be PNG, JPEG, WebP, or SVG.'), false);
        return;
      }
      cb(null, true);
    },
  });
}

// Whitelisted SMS credential keys per gateway — the only keys the UI can set.
const SMS_PROVIDER_KEYS: Record<string, string[]> = {
  africastalking: ['SMS_AT_USERNAME', 'SMS_AT_API_KEY', 'SMS_AT_SENDER_ID', 'SMS_AT_ENV'],
  twilio: ['SMS_TWILIO_ACCOUNT_SID', 'SMS_TWILIO_AUTH_TOKEN', 'SMS_TWILIO_FROM'],
};
const ALL_SMS_KEYS = Object.values(SMS_PROVIDER_KEYS).flat();

@Controller()
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly config: ConfigService,
    private readonly secrets: SecretsService,
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

  /** SMS gateway credential fields + whether each is set (no values leaked). */
  @UseGuards(JwtAuthGuard, AdminGuard)
  @Get('admin/sms-credentials')
  async smsCredentials() {
    const status = await this.secrets.status(ALL_SMS_KEYS);
    return {
      providers: Object.entries(SMS_PROVIDER_KEYS).map(([provider, keys]) => ({
        provider,
        keys: keys.map((key) => ({ key, set: status[key] })),
      })),
    };
  }

  /** Set/clear SMS credentials (empty clears). Whitelisted keys only. */
  @UseGuards(JwtAuthGuard, AdminGuard)
  @Post('admin/sms-credentials')
  async setSmsCredentials(@Body() body: { values?: Record<string, string> }) {
    const values = body?.values ?? {};
    const invalid = Object.keys(values).filter((k) => !ALL_SMS_KEYS.includes(k));
    if (invalid.length) throw new BadRequestException(`Unknown credential key(s): ${invalid.join(', ')}`);
    for (const k of Object.keys(values)) await this.secrets.set(k, values[k]);
    return { ok: true, updated: Object.keys(values).length };
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Post('admin/settings/logo')
  @UseInterceptors(imageUpload(LOGO_DIR, 2 * 1024 * 1024)) // 2MB — a logo, not a poster
  async uploadLogo(@UploadedFile() file: Express.Multer.File) {
    const logoUrl = this.publicUrl('logos', file);
    await this.settings.update({ logoUrl });
    return { logoUrl };
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Post('admin/settings/hero-background')
  @UseInterceptors(imageUpload(BACKGROUND_DIR, 8 * 1024 * 1024)) // 8MB — full-bleed hero art
  async uploadHeroBackground(@UploadedFile() file: Express.Multer.File) {
    const heroBackgroundUrl = this.publicUrl('backgrounds', file);
    await this.settings.update({ heroBackgroundUrl });
    return { heroBackgroundUrl };
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Post('admin/settings/auth-background')
  @UseInterceptors(imageUpload(BACKGROUND_DIR, 8 * 1024 * 1024))
  async uploadAuthBackground(@UploadedFile() file: Express.Multer.File) {
    const authBackgroundUrl = this.publicUrl('backgrounds', file);
    await this.settings.update({ authBackgroundUrl });
    return { authBackgroundUrl };
  }

  private publicUrl(subdir: string, file: Express.Multer.File): string {
    if (!file) throw new BadRequestException('No file uploaded.');
    // PUBLIC_ASSET_PREFIX is "/api" in production (Apache proxies /api/ to
    // this backend) and "" for local dev (backend served directly, no
    // proxy prefix) — see backend/.env.example.
    const prefix = this.config.get<string>('PUBLIC_ASSET_PREFIX') ?? '';
    return `${prefix}/uploads/${subdir}/${file.filename}`;
  }
}
