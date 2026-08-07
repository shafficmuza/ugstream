import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { toE164 } from './phone.util';

/**
 * Wrong guesses before the bypass switches itself off.
 *
 * A development code is short and memorable by design — that is the whole
 * point of it — which means guessing it is cheap. '1234' is ten thousand
 * possibilities and the OTP endpoint accepts hundreds of requests a minute, so
 * without this an attacker who knows a listed number is under a minute from
 * the account. Twelve is far more than anyone typing a code they already know
 * will ever need, and far fewer than a search needs to make progress.
 *
 * Successful use resets the count, so a long development session never drifts
 * into a lockout on accumulated typos.
 */
export const DEV_BYPASS_MAX_FAILURES = 12;

/** Below this, a code is guessable faster than the lockout can react. */
const MIN_CODE_LENGTH = 4;

/** More than a handful of numbers is not a development bypass any more. */
const MAX_PHONES = 5;

export type DevBypassStatus = {
  enabled: boolean;
  /** Whether a code has ever been set — the code itself is stored hashed and never returned. */
  codeSet: boolean;
  phones: string[];
  failures: number;
  failuresRemaining: number;
  setAt: Date | null;
  /** Set when it switched itself off, so the UI can say why rather than just showing "off". */
  autoDisabled: boolean;
};

/**
 * The development sign-in bypass.
 *
 * A fixed code that stands in for the SMS one, on a named handful of numbers,
 * so the team can sign in while building without paying for or waiting on a
 * message. Distinct from the master code: that one is temporary, opens any
 * subscriber, and deliberately refuses privileged accounts. This one is
 * long-lived and *does* open privileged accounts — which is precisely why it
 * is confined to an explicit list of numbers rather than to a role.
 */
@Injectable()
export class DevBypassService {
  private readonly logger = new Logger(DevBypassService.name);

  constructor(private readonly prisma: PrismaService) {}

  private settings() {
    return this.prisma.appSettings.findUnique({ where: { id: 1 } });
  }

  async status(): Promise<DevBypassStatus> {
    const s = await this.settings();
    const failures = s?.devBypassFailures ?? 0;
    return {
      enabled: s?.devBypassEnabled ?? false,
      codeSet: Boolean(s?.devBypassCodeHash),
      phones: s?.devBypassPhones ?? [],
      failures,
      failuresRemaining: Math.max(0, DEV_BYPASS_MAX_FAILURES - failures),
      setAt: s?.devBypassSetAt ?? null,
      autoDisabled: !(s?.devBypassEnabled ?? false) && failures >= DEV_BYPASS_MAX_FAILURES,
    };
  }

  /**
   * Set any of enabled / code / numbers. Omitted fields are left alone, so the
   * UI can toggle it off without having to resend the code.
   */
  async configure(input: { enabled?: boolean; code?: string; phones?: string[] }) {
    const data: Record<string, unknown> = {};

    if (input.code !== undefined) {
      const code = input.code.trim();
      if (code.length < MIN_CODE_LENGTH) {
        throw new BadRequestException(`The code must be at least ${MIN_CODE_LENGTH} characters.`);
      }
      data.devBypassCodeHash = await bcrypt.hash(code, 10);
      data.devBypassSetAt = new Date();
      // A rotation is a fresh start: whatever guessing ran against the old
      // code says nothing about the new one.
      data.devBypassFailures = 0;
    }

    if (input.phones !== undefined) {
      if (input.phones.length > MAX_PHONES) {
        throw new BadRequestException(`At most ${MAX_PHONES} numbers may use the development code.`);
      }
      // Normalised on the way in, because the verify path compares against an
      // E.164 number; '0772…' in this list would silently never match.
      data.devBypassPhones = input.phones.map((p) => toE164(p));
    }

    if (input.enabled !== undefined) {
      data.devBypassEnabled = input.enabled;
      if (input.enabled) data.devBypassFailures = 0;
    }

    const after = await this.prisma.appSettings.update({ where: { id: 1 }, data });

    if (after.devBypassEnabled && !after.devBypassCodeHash) {
      throw new BadRequestException('Set a development code before switching the bypass on.');
    }
    if (after.devBypassEnabled && after.devBypassPhones.length === 0) {
      throw new BadRequestException(
        'List at least one phone number before switching the bypass on — an unscoped code would open every account.',
      );
    }

    if (input.enabled !== undefined) {
      this.logger.warn(
        after.devBypassEnabled
          ? `Development sign-in bypass ENABLED for ${after.devBypassPhones.join(', ')}. ` +
              `These accounts can now be opened with a fixed code and no SMS.`
          : 'Development sign-in bypass disabled.',
      );
    }
    return this.status();
  }

  /** True when this number may use the development code and this is it. */
  async matches(e164Phone: string, code: string): Promise<boolean> {
    const s = await this.settings();
    if (!s?.devBypassEnabled || !s.devBypassCodeHash) return false;
    if (s.devBypassFailures >= DEV_BYPASS_MAX_FAILURES) return false;
    if (!s.devBypassPhones.includes(e164Phone)) return false;
    if (!(await bcrypt.compare(code, s.devBypassCodeHash))) return false;

    if (s.devBypassFailures > 0) {
      await this.prisma.appSettings.update({ where: { id: 1 }, data: { devBypassFailures: 0 } });
    }
    return true;
  }

  /**
   * Charge a wrong code against the bypass, switching it off at the threshold.
   *
   * Only called for numbers actually on the list — a wrong code typed by an
   * ordinary user has nothing to do with this and must not be able to disable
   * the team's access.
   */
  async recordFailure(e164Phone: string): Promise<void> {
    const s = await this.settings();
    if (!s?.devBypassEnabled || !s.devBypassPhones.includes(e164Phone)) return;

    const after = await this.prisma.appSettings.update({
      where: { id: 1 },
      data: { devBypassFailures: { increment: 1 } },
    });

    if (after.devBypassFailures >= DEV_BYPASS_MAX_FAILURES) {
      await this.prisma.appSettings.update({ where: { id: 1 }, data: { devBypassEnabled: false } });
      this.logger.warn(
        `Development sign-in bypass DISABLED after ${after.devBypassFailures} wrong codes on ${e164Phone}. ` +
          `If nobody on the team was mistyping, someone was guessing — rotate the code before switching it back on.`,
      );
    }
  }
}
