import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Deleting your own account.
 *
 * Required by App Store guideline 5.1.1(v): an app that lets people create an
 * account must let them destroy it from inside the app. A support email is
 * explicitly not enough, which is what this codebase offered before — the
 * privacy policy said "email us" and nothing else existed.
 *
 * **It is not a row delete, and cannot be.** payments, subscriptions and
 * purchases all reference `users` under RESTRICT: a DELETE would be refused by
 * the database, and if it were not, it would destroy financial records we are
 * obliged to keep. So the row survives and is emptied of the person instead —
 * which is what the guideline asks for. What is left is a ledger entry with no
 * one attached to it.
 *
 * Everything that is *about* the viewer rather than about money does get
 * deleted outright: what they watched, what they saved, where they were signed
 * in, which handsets could be pushed to.
 *
 * The phone number is released. That matters more than it looks: it is the
 * only login identifier, so freeing it means the same person can sign up again
 * later and arrive as a genuinely new account rather than colliding with a
 * tombstone — and it means the old account can never be reached again, because
 * there is no longer any number that resolves to it.
 */
@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * What the account holder is about to lose, so the confirmation screen can
   * say it in specifics rather than in the abstract.
   *
   * An active subscription is the one that must be named: deleting does not
   * refund it and does not cancel a mobile-money arrangement at the telco, and
   * someone who finds that out afterwards is owed an apology we could have
   * avoided by printing one sentence.
   */
  async deletionSummary(userId: bigint) {
    const now = new Date();
    const [subscription, watched, saved, sessions] = await Promise.all([
      this.prisma.subscription.findFirst({
        where: { userId, expiresAt: { gt: now } },
        orderBy: { expiresAt: 'desc' },
        select: { expiresAt: true },
      }),
      this.prisma.watchHistory.count({ where: { userId } }),
      this.prisma.myListItem.count({ where: { userId } }),
      this.prisma.session.count({ where: { userId } }),
    ]);

    return {
      activeSubscriptionUntil: subscription?.expiresAt ?? null,
      watchHistoryCount: watched,
      myListCount: saved,
      signedInDevices: sessions,
    };
  }

  /**
   * Delete the caller's own account. Irreversible, and immediate.
   *
   * No grace period on purpose. A "deleted" account that quietly still exists
   * for thirty days is the thing 5.1.1(v) was written against, and it is also
   * not what the words mean to the person tapping the button.
   *
   * One transaction: a half-deleted account — personal data gone but the phone
   * still resolving to it — would leave someone able to sign in to a hollow
   * account they had asked to be rid of.
   */
  async deleteOwn(userId: bigint): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, phone: true, status: true },
    });
    if (!user || user.status === 'deleted') return; // already gone; deleting twice is not an error

    const phone = user.phone;

    await this.prisma.$transaction(async (tx) => {
      // Personal history. None of this is a financial record and none of it
      // has any use once the person is gone.
      await tx.watchHistory.deleteMany({ where: { userId } });
      await tx.myListItem.deleteMany({ where: { userId } });
      await tx.streamLease.deleteMany({ where: { userId } });
      // Signs every device out. Refresh tokens live in these rows, so removing
      // them is what actually ends access rather than merely discouraging it.
      await tx.session.deleteMany({ where: { userId } });
      // Push tokens: deleting rather than detaching, so a handset that keeps
      // the app installed cannot go on receiving notifications for an account
      // that no longer exists.
      await tx.device.deleteMany({ where: { userId } });
      // Outstanding codes for this number, so a code already in flight cannot
      // be used against the new account the number is now free to create.
      await tx.otpCode.deleteMany({ where: { phone } });

      // The row itself: emptied, not removed.
      //
      // The phone is replaced with a tombstone rather than nulled because the
      // column is NOT NULL and unique — and the id is what makes it unique.
      // 'deleted:' plus a bigint stays inside VarChar(20) for any id we will
      // ever reach.
      await tx.user.update({
        where: { id: userId },
        data: {
          phone: `deleted:${userId}`,
          displayName: null,
          email: null,
          address: null,
          pinHash: null,
          pinSetAt: null,
          pinFailures: 0,
          pinLockedUntil: null,
          canPreviewAll: false,
          status: 'deleted',
          deletedAt: new Date(),
        },
      });
    });

    // Deliberately without the phone number: this line is the proof the
    // request was honoured, and writing the number into the log would put back
    // the one identifier the whole operation exists to remove.
    this.logger.log(`Account ${userId} deleted at the holder's request.`);
  }
}
