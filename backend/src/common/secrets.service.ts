import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Resolves secret values (payment API credentials, etc.) from the DB-backed
 * `secrets` table first, falling back to the matching env var. This lets an
 * admin enter credentials through the UI without a redeploy, while existing
 * .env values keep working until overridden. Raw values are only ever read
 * server-side — `status()` exposes booleans, never the secret itself.
 */
@Injectable()
export class SecretsService {
  private cache = new Map<string, string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** DB override if present (non-empty), else the env var. */
  async get(key: string): Promise<string | undefined> {
    if (this.cache.has(key)) return this.cache.get(key) || this.config.get<string>(key);
    const row = await this.prisma.secret.findUnique({ where: { key } });
    const val = row?.value ?? '';
    this.cache.set(key, val);
    return val || this.config.get<string>(key);
  }

  /** Set (or clear, when value is empty) a secret override. */
  async set(key: string, value: string): Promise<void> {
    const v = (value ?? '').trim();
    if (v) {
      await this.prisma.secret.upsert({
        where: { key },
        update: { value: v },
        create: { key, value: v },
      });
      this.cache.set(key, v);
    } else {
      await this.prisma.secret.deleteMany({ where: { key } });
      this.cache.delete(key);
    }
  }

  /** True if a key has a usable value (DB override or env), no value leaked. */
  async isSet(key: string): Promise<boolean> {
    return Boolean(await this.get(key));
  }

  /** { key: configured? } for a set of keys — for admin status display. */
  async status(keys: string[]): Promise<Record<string, boolean>> {
    const out: Record<string, boolean> = {};
    for (const k of keys) out[k] = await this.isSet(k);
    return out;
  }
}
