import { BadRequestException } from '@nestjs/common';
import { callingCode, toE164, toE164OrNull } from './phone.util';

/**
 * Normalisation is what stops one person becoming two accounts, and what
 * gives SMS routing a country code to route on. Both failure modes are
 * expensive and neither is visible in testing, so the accepted input forms
 * are pinned here explicitly.
 */
describe('toE164', () => {
  it('normalises every local Ugandan form to one canonical value', () => {
    // The production bug this prevents: these are the same human, and before
    // normalisation each spelling created its own account with its own
    // subscription.
    const canonical = '+256772878614';
    for (const input of [
      '0772878614',
      '+256772878614',
      '256772878614',
      '0772 878 614',
      '+256 772 878 614',
      '(0772) 878-614',
    ]) {
      expect(toE164(input)).toBe(canonical);
    }
  });

  it('accepts international numbers so the diaspora can sign up', () => {
    expect(toE164('+1 415 555 0123')).toBe('+14155550123');
    expect(toE164('+44 7911 123456')).toBe('+447911123456');
  });

  it('rejects numbers that cannot be dialled', () => {
    for (const bad of ['', '   ', '123', 'not a phone', '+256000', '07728786141234']) {
      expect(() => toE164(bad)).toThrow(BadRequestException);
    }
  });

  it('does not mistake a bare country-code form for a local number', () => {
    // '256772878614' has no '+' and no leading '0'; read as a local UG number
    // it is nonsense, so it must be interpreted as international.
    expect(toE164('256772878614')).toBe('+256772878614');
  });

  it('preserves a leading zero as a local prefix, not a digit', () => {
    // 0772878614 is 10 digits; the '0' is a trunk prefix and must be dropped,
    // not carried into the subscriber number.
    expect(toE164('0772878614')).toBe('+256772878614');
  });

  it('corrects a trunk zero left in after a country code', () => {
    // What a country picker produces when someone types their number the way
    // they always write it. Universal habit, not an error worth refusing.
    expect(toE164('+2560772878614')).toBe('+256772878614');
    expect(toE164('+4407911123456')).toBe('+447911123456');
  });

  it('ignores punctuation people naturally type', () => {
    // A space in a phone number is not a validation failure. One reached the
    // production users table as its own account before this existed.
    expect(toE164('+256775 200442')).toBe('+256775200442');
    expect(toE164('+256-775-200-442')).toBe('+256775200442');
    expect(toE164(' 0775 200 442 ')).toBe('+256775200442');
  });
});

describe('callingCode', () => {
  it('extracts the country code routing depends on', () => {
    expect(callingCode('+256772878614')).toBe('256');
    expect(callingCode('+14155550123')).toBe('1');
    expect(callingCode('+254712345678')).toBe('254');
  });

  it('returns empty for unparseable input rather than throwing', () => {
    expect(callingCode('garbage')).toBe('');
  });
});

describe('toE164OrNull', () => {
  it('returns null instead of throwing, for bulk work over existing rows', () => {
    expect(toE164OrNull('nonsense')).toBeNull();
    expect(toE164OrNull('0772878614')).toBe('+256772878614');
  });
});
