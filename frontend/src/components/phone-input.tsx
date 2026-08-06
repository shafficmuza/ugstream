'use client';

import { useMemo, useState } from 'react';
import {
  AsYouType,
  getCountries,
  getCountryCallingCode,
  parsePhoneNumberFromString,
  type CountryCode,
} from 'libphonenumber-js';

/**
 * Country selector + national number field.
 *
 * Replaces a single free-text box that assumed Uganda. Two things it has to
 * get right, both of which people do constantly and neither of which is a
 * mistake worth rejecting them over:
 *
 *  - a leading trunk zero. Ugandans write 0772123456; prefixing the country
 *    code naively yields +2560772123456, which is not a number. The zero is
 *    stripped here, and again on the server for clients that don't.
 *  - punctuation. Spaces, dashes and brackets are how people write phone
 *    numbers, and are discarded rather than refused.
 */

/** Shown first — the home market and the largest diaspora destinations. */
const PRIORITY: CountryCode[] = ['UG', 'US', 'GB', 'CA', 'AE', 'ZA', 'KE', 'TZ', 'RW'];

const REGION_NAMES =
  typeof Intl !== 'undefined' && 'DisplayNames' in Intl
    ? new Intl.DisplayNames(['en'], { type: 'region' })
    : null;

function countryName(code: CountryCode): string {
  return REGION_NAMES?.of(code) ?? code;
}

/** Regional-indicator pair, so the list reads at a glance on mobile. */
function flag(code: string): string {
  return String.fromCodePoint(...[...code].map((c) => 0x1f1a5 + c.charCodeAt(0)));
}

export interface PhoneInputProps {
  country: CountryCode;
  onCountryChange: (c: CountryCode) => void;
  national: string;
  onNationalChange: (v: string) => void;
  autoFocus?: boolean;
  inputStyle?: React.CSSProperties;
}

/**
 * Assemble what the user chose and typed into E.164. Returns null while the
 * number is not yet valid, so the caller can keep the submit button honest.
 */
export function composePhone(country: CountryCode, national: string): string | null {
  const digits = national.replace(/[^\d]/g, '').replace(/^0+/, '');
  if (!digits) return null;
  const parsed = parsePhoneNumberFromString(`+${getCountryCallingCode(country)}${digits}`);
  return parsed?.isValid() ? parsed.number : null;
}

export default function PhoneInput({
  country,
  onCountryChange,
  national,
  onNationalChange,
  autoFocus,
  inputStyle,
}: PhoneInputProps) {
  const [touched, setTouched] = useState(false);

  const countries = useMemo(() => {
    const rest = getCountries()
      .filter((c) => !PRIORITY.includes(c))
      .sort((a, b) => countryName(a).localeCompare(countryName(b)));
    return [...PRIORITY, ...rest];
  }, []);

  const dial = getCountryCallingCode(country);
  const composed = composePhone(country, national);
  const strippedZero = /^0/.test(national.trim());

  return (
    <div style={{ marginBottom: 12 }}>
      <select
        value={country}
        onChange={(e) => onCountryChange(e.target.value as CountryCode)}
        style={{ ...inputStyle, marginBottom: 8 }}
        aria-label="Country"
      >
        {countries.map((c, i) => (
          <option key={c} value={c}>
            {flag(c)} {countryName(c)} +{getCountryCallingCode(c)}
            {i === PRIORITY.length - 1 ? ' ──────────' : ''}
          </option>
        ))}
      </select>

      <div style={{ display: 'flex', alignItems: 'stretch', gap: 8 }}>
        <span
          style={{
            ...inputStyle,
            width: 'auto',
            minWidth: 72,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 0,
            opacity: 0.75,
            whiteSpace: 'nowrap',
          }}
        >
          +{dial}
        </span>
        <input
          value={national}
          onChange={(e) => onNationalChange(e.target.value)}
          onBlur={() => setTouched(true)}
          // Formats as they type, which makes a wrong-length number obvious
          // before they ever press the button.
          placeholder={new AsYouType(country).input('700000000') || '700000000'}
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          autoFocus={autoFocus}
          style={{ ...inputStyle, marginBottom: 0, flex: 1 }}
          aria-label="Phone number"
        />
      </div>

      {strippedZero && (
        <p style={{ opacity: 0.55, fontSize: 12, marginTop: 6 }}>
          The leading 0 isn&rsquo;t needed with a country code — we&rsquo;ll drop it.
        </p>
      )}
      {touched && national.trim() !== '' && !composed && (
        <p style={{ color: '#ffb020', fontSize: 12, marginTop: 6 }}>
          That doesn&rsquo;t look like a valid {countryName(country)} number yet.
        </p>
      )}
    </div>
  );
}
