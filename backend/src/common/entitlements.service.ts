import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type EntitlementResult =
  | { entitled: true; reason: 'free' | 'subscription' | 'purchase' | 'staff' }
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
    // Watch access is a separate axis from the admin-portal role, but two
    // role facts short-circuit it: a banned account is never entitled, and
    // staff (admin/editor) get complimentary access to everything for
    // review/QA — they never hit the paywall. Everyone else is gated purely
    // by their live subscription/purchase rows below.
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, status: true },
    });
    if (!user || user.status === 'banned') return { entitled: false };
    if (user.role === 'admin' || user.role === 'editor') return { entitled: true, reason: 'staff' };

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
