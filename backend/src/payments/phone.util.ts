import { BadRequestException } from '@nestjs/common';

/**
 * Normalise a Ugandan mobile-money number to `256XXXXXXXXX` (no '+').
 * Accepts `0772…`, `+256772…`, `256772…`, or `772…`. Throws on anything
 * that isn't a plausible 12-digit Ugandan MSISDN.
 */
export function normalizeUgPhone(input: string): string {
  let n = (input ?? '').replace(/[^\d]/g, '');
  if (n.startsWith('0')) n = '256' + n.slice(1);
  else if (n.length === 9) n = '256' + n; // e.g. 772123456
  if (!/^256\d{9}$/.test(n)) {
    throw new BadRequestException('Enter a valid Ugandan mobile money number, e.g. 0772123456.');
  }
  return n;
}
