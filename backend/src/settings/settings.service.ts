import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface UpdateSettingsInput {
  appName?: string;
  logoUrl?: string;
  tagline?: string;
  supportEmail?: string;
  supportPhone?: string;
  heroBackgroundUrl?: string;
  authBackgroundUrl?: string;
  mobileMoneyProvider?: string;
  smsProvider?: string;
  pushEnabled?: boolean;
  pushAudience?: string;
  maxSessions?: number;
  maxStreams?: number;
}

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async get() {
    // Singleton row, created on first read so the app never 404s on a
    // brand-new deployment before an admin has touched settings.
    return this.prisma.appSettings.upsert({
      where: { id: 1 },
      update: {},
      create: { id: 1 },
    });
  }

  async update(input: UpdateSettingsInput) {
    return this.prisma.appSettings.upsert({
      where: { id: 1 },
      update: input,
      create: { id: 1, ...input },
    });
  }
}
