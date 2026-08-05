import { Injectable, Logger } from '@nestjs/common';
import * as admin from 'firebase-admin';
import { PrismaService } from '../prisma/prisma.service';
import { SecretsService } from '../common/secrets.service';

/** Key holding the Firebase service-account JSON (entered in the admin UI). */
export const FIREBASE_SERVICE_ACCOUNT = 'FIREBASE_SERVICE_ACCOUNT';

/** FCM rejects anything larger; keep well clear so long synopses don't fail. */
const MAX_BODY = 240;

/** FCM's documented ceiling for a single multicast call. */
const FCM_BATCH = 500;

export interface PushPayload {
  title: string;
  body: string;
  /** Deep-link path, e.g. "/title/some-slug". Opened when the user taps. */
  path?: string;
  imageUrl?: string;
}

export interface PushResult {
  sent: number;
  failed: number;
  pruned: number;
}

/**
 * Sends push notifications through Firebase Cloud Messaging.
 *
 * Credentials come from the secrets store rather than a file on disk, so the
 * platform can be pointed at a Firebase project from the admin UI like every
 * other integration. Until that value is set the service reports itself as
 * unconfigured and every send is a no-op — the rest of the app (publishing a
 * title, in particular) must never fail because push is not set up yet.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private app?: admin.app.App;
  /** Service-account JSON the current app was built from, to detect changes. */
  private initialisedWith?: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly secrets: SecretsService,
  ) {}

  async isConfigured(): Promise<boolean> {
    return Boolean(await this.secrets.get(FIREBASE_SERVICE_ACCOUNT));
  }

  /**
   * Build (or rebuild) the Firebase app. Rebuilt when the stored credential
   * changes so swapping Firebase projects in the UI takes effect without a
   * restart. Returns undefined when unconfigured or the JSON is unusable.
   */
  private async client(): Promise<admin.app.App | undefined> {
    const raw = await this.secrets.get(FIREBASE_SERVICE_ACCOUNT);
    if (!raw) return undefined;
    if (this.app && this.initialisedWith === raw) return this.app;

    let creds: admin.ServiceAccount;
    try {
      creds = JSON.parse(raw);
    } catch {
      this.logger.error('Firebase service account is not valid JSON — push disabled');
      return undefined;
    }

    try {
      // Named app so re-initialising after a credential change doesn't clash
      // with the default app, and delete the old one to avoid leaking it.
      if (this.app) await this.app.delete().catch(() => undefined);
      this.app = admin.initializeApp(
        { credential: admin.credential.cert(creds) },
        `ugstream-${Date.now()}`,
      );
      this.initialisedWith = raw;
      return this.app;
    } catch (err) {
      this.logger.error(`Could not initialise Firebase: ${(err as Error).message}`);
      return undefined;
    }
  }

  /**
   * Tokens to notify for an audience.
   *
   * 'subscribers' means users with a live subscription; 'all' means every
   * registered device including signed-out ones, since a not-yet-subscribed
   * viewer is exactly who a new-title announcement is meant to reach. Banned
   * users are excluded from both — they keep the app installed but must not
   * be marketed to.
   */
  private async audienceTokens(audience: string): Promise<string[]> {
    const notBanned = { OR: [{ userId: null }, { user: { status: 'active' as const } }] };

    if (audience === 'subscribers') {
      const rows = await this.prisma.device.findMany({
        where: {
          userId: { not: null },
          user: {
            status: 'active',
            subscriptions: { some: { expiresAt: { gt: new Date() } } },
          },
        },
        select: { token: true },
      });
      return rows.map((r) => r.token);
    }

    const rows = await this.prisma.device.findMany({
      where: notBanned,
      select: { token: true },
    });
    return rows.map((r) => r.token);
  }

  /**
   * Deliver to an audience. Never throws: push is a side effect of publishing
   * and must not be able to fail the publish itself.
   */
  async sendToAudience(audience: string, payload: PushPayload): Promise<PushResult> {
    const tokens = await this.audienceTokens(audience);
    return this.sendToTokens(tokens, payload);
  }

  async sendToTokens(tokens: string[], payload: PushPayload): Promise<PushResult> {
    const result: PushResult = { sent: 0, failed: 0, pruned: 0 };
    if (!tokens.length) return result;

    const app = await this.client();
    if (!app) {
      this.logger.warn('Push requested but Firebase is not configured — skipping');
      return result;
    }

    const body = payload.body.length > MAX_BODY
      ? `${payload.body.slice(0, MAX_BODY - 1).trimEnd()}…`
      : payload.body;

    const dead: string[] = [];

    for (let i = 0; i < tokens.length; i += FCM_BATCH) {
      const batch = tokens.slice(i, i + FCM_BATCH);
      try {
        const res = await app.messaging().sendEachForMulticast({
          tokens: batch,
          notification: { title: payload.title, body, imageUrl: payload.imageUrl },
          // Data must be all-strings for FCM. The app reads `path` to decide
          // where to navigate when the notification is tapped.
          data: { path: payload.path ?? '/' },
          android: {
            priority: 'high',
            notification: { channelId: 'new_titles', imageUrl: payload.imageUrl },
          },
          apns: {
            payload: { aps: { sound: 'default', contentAvailable: true } },
            ...(payload.imageUrl
              ? { fcmOptions: { imageUrl: payload.imageUrl } }
              : {}),
          },
        });

        res.responses.forEach((r, idx) => {
          if (r.success) {
            result.sent += 1;
            return;
          }
          result.failed += 1;
          const code = r.error?.code ?? '';
          // These mean the install is gone or the token is malformed; keeping
          // them would make every future send look progressively worse and
          // waste quota, so drop them.
          if (
            code === 'messaging/registration-token-not-registered' ||
            code === 'messaging/invalid-registration-token' ||
            code === 'messaging/invalid-argument'
          ) {
            dead.push(batch[idx]);
          }
        });
      } catch (err) {
        result.failed += batch.length;
        this.logger.error(`FCM batch failed: ${(err as Error).message}`);
      }
    }

    if (dead.length) {
      const { count } = await this.prisma.device.deleteMany({
        where: { token: { in: dead } },
      });
      result.pruned = count;
    }

    return result;
  }
}
