import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module';
import { JwtGlobalModule } from './common/jwt-global.module';
import { SecretsModule } from './common/secrets.module';
import { ActivityModule } from './common/activity.module';
import { AuthModule } from './auth/auth.module';
import { TitlesModule } from './titles/titles.module';
import { GenresModule } from './genres/genres.module';
import { KindsModule } from './kinds/kinds.module';
import { EpisodesModule } from './episodes/episodes.module';
import { PlansModule } from './plans/plans.module';
import { PaymentsModule } from './payments/payments.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { SettingsModule } from './settings/settings.module';
import { MediaModule } from './media/media.module';
import { AdminModule } from './admin/admin.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ActivityInterceptor } from './common/activity.interceptor';
import { HealthController } from './common/health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot({ throttlers: [{ ttl: 60_000, limit: 100 }] }),
    PrismaModule,
    JwtGlobalModule,
    SecretsModule,
    ActivityModule,
    AuthModule,
    TitlesModule,
    GenresModule,
    KindsModule,
    EpisodesModule,
    PlansModule,
    PaymentsModule,
    WebhooksModule,
    SettingsModule,
    MediaModule,
    AdminModule,
    NotificationsModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_INTERCEPTOR, useClass: ActivityInterceptor },
  ],
})
export class AppModule {}
