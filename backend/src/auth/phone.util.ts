import { BadRequestException } from '@nestjs/common';
import parsePhoneNumberFromString from 'libphonenumber-js';

/**
 * Canonical phone handling for authentication.
 *
 * Every phone that reaches the auth layer is normalised to E.164 (`+256772…`)
 * before it is stored or looked up. This is not cosmetic: `users.phone` is
 * unique, so without normalisation the same person typing `0772878614` on
 * their phone and `+256772878614` on the web gets two separate accounts with
 * separate subscriptions — which is exactly what happened in production
 * before this was introduced.
 *
 * It is also what makes cost-based SMS routing possible at all: a local-format
 * number carries no country code, so there is nothing to route on.
 *
 * Distinct from `payments/phone.util.ts`, which produces the bare `256XXXXXXXXX`
 * form that mobile-money APIs require and deliberately rejects non-Ugandan
 * numbers. Auth accepts the world; mobile money does not.
 */

/** Numbers with no country code are assumed to be Ugandan — the home market. */
const DEFAULT_REGION = 'UG';

/**
 * Normalise any accepted input to E.164.
 *
 * Accepts `0772123456`, `+256772123456`, `256772123456`, `+1 415 555 0123`,
 * and the same with spaces, dashes or parentheses. Throws on anything that
 * isn't a valid, dialable number.
 */
export function toE164(input: string): string {
  const raw = (input ?? '').trim();
  if (!raw) throw new BadRequestException('Enter your phone number.');

  // A bare `256772123456` is ambiguous to the parser without a '+': with a
  // default region of UG it would be read as a (nonsense) local number. Only
  // treat it as international when it can't be a local one.
  const digits = raw.replace(/[^\d]/g, '');
  const candidate =
    !raw.startsWith('+') && !digits.startsWith('0') && digits.length > 10 ? `+${digits}` : raw;

  const parsed = parsePhoneNumberFromString(candidate, DEFAULT_REGION);
  if (!parsed || !parsed.isValid()) {
    throw new BadRequestException(
      'Enter a valid phone number, e.g. 0772123456 or +1 415 555 0123.',
    );
  }
  return parsed.number;
}

/** Country calling code of an E.164 number, without the '+' (e.g. '256'). */
export function callingCode(e164: string): string {
  return parsePhoneNumberFromString(e164)?.countryCallingCode ?? '';
}

/**
 * Same as {@link toE164} but returns null instead of throwing. For bulk work
 * over existing rows, where a number that can no longer be parsed must be
 * skipped rather than abort the batch.
 */
export function toE164OrNull(input: string): string | null {
  try {
    return toE164(input);
  } catch {
    return null;
  }
}
