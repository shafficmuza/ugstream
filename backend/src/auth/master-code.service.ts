import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Wrong guesses before the active code disables itself.
 *
 * A six-digit code is a million possibilities, so an attacker who could guess
 * freely would expect to be inside an account in ~500k tries — minutes of
 * scripted traffic. Ten kills that outright: the code stops working long
 * before a search makes progress.
 *
 * The tradeoff is that anyone who knows a master code exists can disable it by
 * guessing wrong ten times. That is the right way round — the failure mode is
 * "admin issues a new code", not "attacker owns every account".
 */
export const MASTER_CODE_MAX_FAILURES = 10;

/** Default lifetime when an admin doesn't pick one: long enough to ride out an outage and a night's sleep. */
export const MASTER_CODE_DEFAULT_HOURS = 24;

/** Hard ceiling. A break-glass code that lives a fortnight is just a password. */
export const MASTER_CODE_MAX_HOURS = 24 * 7;

export type MasterCodeStatus = {
  active: boolean;
  expiresAt: Date | null;
  issuedAt: Date | null;
  uses: number;
  failures: number;
  failuresRemaining: number;
  /** Set when the most recent code exists but is no longer usable, so the UI can say why. */
  inactiveReason: 'none-issued' | 'expired' | 'revoked' | 'locked-out' | null;
};

/**
 * Issues and validates the break-glass sign-in code.
 *
 * Kept apart from AuthService so the ordinary OTP path stays readable and so
 * there is exactly one place that decides whether a master code is live — the
 * bug you cannot afford here is two callers disagreeing about that.
 */
@Injectable()
export class MasterCodeService {
  private readonly logger = new Logger(MasterCodeService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Mint a code, retiring any predecessor. Returns the plaintext — the only
   * time it exists outside the admin's hands, since only the hash is stored.
   */
  async issue(adminId: bigint, hours = MASTER_CODE_DEFAULT_HOURS) {
    if (!Number.isFinite(hours) || hours <= 0 || hours > MASTER_CODE_MAX_HOURS) {
      throw new BadRequestException(`Validity must be between 1 and ${MASTER_CODE_MAX_HOURS} hours.`);
    }

    // Six digits, because the shipped clients cap the code field at six
    // characters — a longer code would be unenterable on every build already
    // in users' hands, which is precisely who this exists for.
    const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
    const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);

    await this.prisma.$transaction(async (tx) => {
      await tx.masterCode.updateMany({ where: { revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.masterCode.create({
        data: { codeHash: await bcrypt.hash(code, 10), expiresAt, issuedByAdminId: adminId },
      });
    });

    this.logger.warn(
      `Admin ${adminId} issued a MASTER sign-in code valid until ${expiresAt.toISOString()}. ` +
        `It opens any non-privileged account until then.`,
    );
    return { code, expiresAt, expiresInHours: hours };
  }

  async revoke(adminId: bigint): Promise<boolean> {
    const { count } = await this.prisma.masterCode.updateMany({
      where: { revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (count > 0) this.logger.warn(`Admin ${adminId} revoked the master sign-in code.`);
    return count > 0;
  }

  /** The active code, or null. Expiry and lockout are enforced here, not by the caller. */
  private async active() {
    const code = await this.prisma.masterCode.findFirst({
      where: { revokedAt: null, expiresAt: { gt: new Date() }, failures: { lt: MASTER_CODE_MAX_FAILURES } },
      orderBy: { id: 'desc' },
    });
    return code;
  }

  async status(): Promise<MasterCodeStatus> {
    const latest = await this.prisma.masterCode.findFirst({ orderBy: { id: 'desc' } });
    if (!latest) {
      return {
        active: false,
        expiresAt: null,
        issuedAt: null,
        uses: 0,
        failures: 0,
        failuresRemaining: MASTER_CODE_MAX_FAILURES,
        inactiveReason: 'none-issued',
      };
    }

    const inactiveReason: MasterCodeStatus['inactiveReason'] = latest.revokedAt
      ? 'revoked'
      : latest.failures >= MASTER_CODE_MAX_FAILURES
        ? 'locked-out'
        : latest.expiresAt.getTime() <= Date.now()
          ? 'expired'
          : null;

    return {
      active: inactiveReason === null,
      expiresAt: latest.expiresAt,
      issuedAt: latest.createdAt,
      uses: latest.uses,
      failures: latest.failures,
      failuresRemaining: Math.max(0, MASTER_CODE_MAX_FAILURES - latest.failures),
      inactiveReason,
    };
  }

  /**
   * True when the submitted code is the live master code.
   *
   * Deliberately read-only. Matching the code is not the same as being let in
   * — the caller still refuses privileged accounts, banned accounts and
   * numbers with no account at all — so counting a use here would report
   * refused attempts as successful sign-ins in the admin panel, which is
   * exactly the number an admin would be watching during an incident.
   */
  async matches(code: string): Promise<boolean> {
    const master = await this.active();
    if (!master) return false;
    return bcrypt.compare(code, master.codeHash);
  }

  /** Called once a master-code sign-in has actually succeeded. */
  async recordUse(): Promise<void> {
    const master = await this.active();
    if (!master) return;
    await this.prisma.masterCode.update({ where: { id: master.id }, data: { uses: { increment: 1 } } });
  }

  /**
   * Charge a failed sign-in against the active code, disabling it at the
   * threshold. Called only when the submitted code matched no real OTP either,
   * so ordinary typos on a genuine code never count here.
   */
  async recordFailure(): Promise<void> {
    const master = await this.active();
    if (!master) return;

    const updated = await this.prisma.masterCode.update({
      where: { id: master.id },
      data: { failures: { increment: 1 } },
    });
    if (updated.failures >= MASTER_CODE_MAX_FAILURES) {
      this.logger.warn(
        `Master sign-in code disabled after ${updated.failures} failed attempts. ` +
          `This may be a brute-force attempt; issue a new code only if you still need one.`,
      );
    }
  }
}
