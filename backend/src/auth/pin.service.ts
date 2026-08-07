import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';

const MIN_PIN_LENGTH = 4;
const MAX_PIN_LENGTH = 8;

/**
 * Wrong PINs before the account stops accepting them for a while.
 *
 * A four-digit PIN is ten thousand possibilities. Without a lockout, an
 * endpoint that answers a few hundred requests a minute gives away any account
 * whose number is known within the hour. Five attempts per fifteen minutes
 * puts an exhaustive search past a century, while leaving room for someone who
 * simply mistyped.
 *
 * A locked PIN is never a locked account: the SMS code still works throughout,
 * so the worst case is one message, not a support ticket.
 */
const PIN_MAX_FAILURES = 5;
const PIN_LOCKOUT_MINUTES = 15;

/** Rejected outright — these are the first guesses anyone makes. */
function isTooObvious(pin: string): boolean {
  if (/^(\d)\1*$/.test(pin)) return true; // 0000, 1111, …
  const ascending = pin.split('').every((d, i, a) => i === 0 || +d === +a[i - 1] + 1);
  const descending = pin.split('').every((d, i, a) => i === 0 || +d === +a[i - 1] - 1);
  return ascending || descending; // 1234, 4321, …
}

/**
 * The user's own sign-in PIN.
 *
 * Set after a verified sign-in, and from then on a returning user signs in
 * with it instead of waiting for — and being charged for — an SMS. This is the
 * single largest lever on the messaging bill: an OTP is spent once per account
 * rather than once per sign-in.
 *
 * A PIN is deliberately a shortcut and never the only key. The OTP path stays
 * open at all times, which is what allows the lockout above to be strict: a
 * user who forgets or fumbles their PIN is one message away from their
 * account, so nothing here needs to fail open.
 */
@Injectable()
export class PinService {
  private readonly logger = new Logger(PinService.name);

  constructor(private readonly prisma: PrismaService) {}

  private validate(pin: string): string {
    const trimmed = (pin ?? '').trim();
    if (!/^\d+$/.test(trimmed)) {
      throw new BadRequestException('Your PIN must be numbers only.');
    }
    if (trimmed.length < MIN_PIN_LENGTH || trimmed.length > MAX_PIN_LENGTH) {
      throw new BadRequestException(
        `Your PIN must be between ${MIN_PIN_LENGTH} and ${MAX_PIN_LENGTH} digits.`,
      );
    }
    if (isTooObvious(trimmed)) {
      throw new BadRequestException(
        'That PIN is too easy to guess. Avoid repeated digits and simple runs like 1234.',
      );
    }
    return trimmed;
  }

  /**
   * Set or replace the caller's PIN.
   *
   * Replacing one requires the current PIN. The caller is already
   * authenticated, so this is not about proving who they are — it is so that a
   * borrowed or briefly unattended phone cannot be used to change the PIN and
   * lock the owner out of their own account.
   */
  async set(userId: bigint, pin: string, currentPin?: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });

    if (user.pinHash) {
      if (!currentPin) throw new BadRequestException('Enter your current PIN to change it.');
      if (!(await bcrypt.compare(currentPin, user.pinHash))) {
        throw new UnauthorizedException('That is not your current PIN.');
      }
    }

    const validated = this.validate(pin);
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        pinHash: await bcrypt.hash(validated, 10),
        pinSetAt: new Date(),
        pinFailures: 0,
        pinLockedUntil: null,
      },
    });
    return { pinSet: true };
  }

  /** Remove the PIN, returning the account to SMS codes only. */
  async clear(userId: bigint) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { pinHash: null, pinSetAt: null, pinFailures: 0, pinLockedUntil: null },
    });
    return { pinSet: false };
  }

  /**
   * Whether this number can sign in with a PIN right now, so the client knows
   * which screen to show.
   *
   * Answers `false` for numbers with no account at all, which is the same
   * answer as for an account with no PIN — this endpoint does not become a way
   * to test whether somebody is a subscriber.
   */
  async isAvailableFor(phone: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { phone },
      select: { pinHash: true, status: true, pinLockedUntil: true },
    });
    if (!user?.pinHash || user.status === 'banned') return false;
    return !(user.pinLockedUntil && user.pinLockedUntil > new Date());
  }

  /**
   * Check a PIN for sign-in, applying the lockout.
   *
   * Returns the user on success. Every failure path raises, so a caller cannot
   * accidentally treat a wrong PIN as a pass.
   */
  async verify(phone: string, pin: string) {
    const user = await this.prisma.user.findUnique({ where: { phone } });

    // Same message whether the number is unknown, has no PIN, or the PIN is
    // wrong: any difference here is a way to enumerate accounts.
    const wrong = () => new UnauthorizedException('Incorrect PIN.');
    if (!user?.pinHash) throw wrong();
    if (user.status === 'banned') throw new UnauthorizedException('This account has been suspended.');

    if (user.pinLockedUntil && user.pinLockedUntil > new Date()) {
      const minutes = Math.max(1, Math.ceil((user.pinLockedUntil.getTime() - Date.now()) / 60_000));
      throw new UnauthorizedException(
        `Too many incorrect PINs. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}, or sign in with a code by SMS.`,
      );
    }

    if (!(await bcrypt.compare(pin, user.pinHash))) {
      const failures = user.pinFailures + 1;
      const locked = failures >= PIN_MAX_FAILURES;
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          pinFailures: locked ? 0 : failures,
          pinLockedUntil: locked ? new Date(Date.now() + PIN_LOCKOUT_MINUTES * 60_000) : null,
        },
      });
      if (locked) {
        this.logger.warn(`PIN sign-in locked for ${phone} after ${PIN_MAX_FAILURES} wrong attempts.`);
        throw new UnauthorizedException(
          `Too many incorrect PINs. Try again in ${PIN_LOCKOUT_MINUTES} minutes, or sign in with a code by SMS.`,
        );
      }
      throw wrong();
    }

    if (user.pinFailures > 0 || user.pinLockedUntil) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { pinFailures: 0, pinLockedUntil: null },
      });
    }
    return user;
  }
}
