import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type EntitlementResult =
  | { entitled: true; reason: 'free' | 'subscription' | 'purchase' }
  | { entitled: false };

/**
 * Single source of truth for "can this user watch this title right now".
 * Deliberately derived from live rows (no cached flag on the user) so a
 * canceled subscription or expired rental takes effect immediately.
 */
@Injectable()
export class EntitlementsService {
  constructor(private readonly prisma: PrismaService) {}

  async check(userId: bigint, titleId: bigint): Promise<EntitlementResult> {
    const title = await this.prisma.title.findUniqueOrThrow({ where: { id: titleId } });

    if (title.access === 'free') return { entitled: true, reason: 'free' };

    const now = new Date();

    if (title.access === 'subscription' || title.access === 'sub_or_purchase') {
      const activeSub = await this.prisma.subscription.findFirst({
        where: { userId, expiresAt: { gt: now } },
      });
      if (activeSub) return { entitled: true, reason: 'subscription' };
    }

    if (title.access === 'purchase' || title.access === 'sub_or_purchase') {
      const activePurchase = await this.prisma.purchase.findFirst({
        where: { userId, titleId, expiresAt: { gt: now } },
      });
      if (activePurchase) return { entitled: true, reason: 'purchase' };
    }

    return { entitled: false };
  }
}
