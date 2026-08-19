import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface UpdateSettingsInput {
  appName?: string;
  logoUrl?: string;
  tagline?: string;
  // Nullable, unlike the rest: these four are the only settings a client is
  // allowed to *clear*. `undefined` still means "leave alone" — Prisma skips
  // it — so an explicit null is the only way to say "this channel is gone",
  // and passing `input` straight to Prisma is what keeps that null a null
  // write instead of a dropped key.
  supportEmail?: string | null;
  supportPhone?: string | null;
  supportWhatsapp?: string | null;
  supportHours?: string | null;
  heroBackgroundUrl?: string;
  authBackgroundUrl?: string;
  mobileMoneyProvider?: string;
  smsProvider?: string;
  pushEnabled?: boolean;
  pushAudience?: string;
  maxSessions?: number;
  maxStreams?: number;
  otpCooldownSeconds?: number;
  otpPerHour?: number;
  otpPerDay?: number;
}

/**
 * Everything GET /settings is allowed to publish. That endpoint is
 * unauthenticated — it is what the web app and the mobile app read before
 * anyone signs in — while the row behind it also holds the development
 * sign-in bypass: the bcrypt hash of a four-digit code and the list of phone
 * numbers it opens. Returning the row wholesale handed both to the internet.
 *
 * A whitelist rather than a delete-list on purpose: with a select, a column
 * added to AppSettings tomorrow is private until someone puts it here, which
 * is the safe direction to be wrong in. A blacklist gets the same field wrong
 * silently, at whatever moment the model grows.
 */
export const PUBLIC_SETTINGS_SELECT = {
  appName: true,
  logoUrl: true,
  tagline: true,
  supportEmail: true,
  supportPhone: true,
  supportWhatsapp: true,
  supportHours: true,
  heroBackgroundUrl: true,
  authBackgroundUrl: true,
  mobileMoneyProvider: true,
  smsProvider: true,
  pushEnabled: true,
  pushAudience: true,
  maxSessions: true,
  maxStreams: true,
  otpCooldownSeconds: true,
  otpPerHour: true,
  otpPerDay: true,
} satisfies Prisma.AppSettingsSelect;

export type PublicSettings = Prisma.AppSettingsGetPayload<{ select: typeof PUBLIC_SETTINGS_SELECT }>;

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async get(): Promise<PublicSettings> {
    // Singleton row, created on first read so the app never 404s on a
    // brand-new deployment before an admin has touched settings.
    return this.prisma.appSettings.upsert({
      where: { id: 1 },
      update: {},
      create: { id: 1 },
      select: PUBLIC_SETTINGS_SELECT,
    });
  }

  async update(input: UpdateSettingsInput): Promise<PublicSettings> {
    // Projected as well: the admin PATCH echoes the saved row back, and an
    // admin session is not a reason to hand out the bypass hash — the same
    // reason admin/dev-bypass accepts a code but never reads one back.
    return this.prisma.appSettings.upsert({
      where: { id: 1 },
      update: input,
      create: { id: 1, ...input },
      select: PUBLIC_SETTINGS_SELECT,
    });
  }
}
