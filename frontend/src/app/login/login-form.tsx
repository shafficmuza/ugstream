'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import PhoneInput, { composePhone } from '@/components/phone-input';
import type { CountryCode } from 'libphonenumber-js';

export function LoginForm() {
  const router = useRouter();
  const { login } = useAuth();
  const [country, setCountry] = useState<CountryCode>('UG');
  const [national, setNational] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // E.164 assembled from the country and the national part, or null while the
  // number is incomplete. Kept in one place so what is displayed on the code
  // screen is exactly what was sent.
  const phone = composePhone(country, national);

  async function requestOtp(e?: React.FormEvent) {
    e?.preventDefault();
    if (!phone) {
      setError('Enter your phone number.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await apiFetch('/auth/otp/request', { method: 'POST', body: { phone } });
      setStep('code');
    } catch (e: any) {
      setError(e.message ?? 'Failed to send code.');
    } finally {
      setLoading(false);
    }
  }

  async function verifyOtp(e?: React.FormEvent) {
    e?.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<{ accessToken: string; refreshToken: string }>(
        '/auth/otp/verify',
        { method: 'POST', body: { phone, code, deviceLabel: navigator.userAgent.slice(0, 90) } },
      );
      await login(res.accessToken, res.refreshToken);
      router.push('/');
    } catch (e: any) {
      setError(e.message ?? 'Invalid code.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-card">
      <h1 style={{ fontSize: 22 }}>Log in</h1>

      {step === 'phone' && (
        <form onSubmit={requestOtp}>
          <PhoneInput
            country={country}
            onCountryChange={setCountry}
            national={national}
            onNationalChange={setNational}
            autoFocus
            inputStyle={inputStyle}
          />
          <button
            className="btn"
            style={{ width: '100%' }}
            type="submit"
            disabled={loading || !phone}
          >
            {loading ? 'Sending…' : 'Send code'}
          </button>
        </form>
      )}

      {step === 'code' && (
        <form onSubmit={verifyOtp}>
          <p style={{ opacity: 0.7, fontSize: 14 }}>Enter the 6-digit code sent to {phone}</p>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="123456"
            maxLength={6}
            inputMode="numeric"
            autoFocus
            style={inputStyle}
          />
          <button className="btn" style={{ width: '100%' }} type="submit" disabled={loading}>
            {loading ? 'Verifying…' : 'Verify & continue'}
          </button>
        </form>
      )}

      {error && <p style={{ color: '#ff6b6b', marginTop: 12 }}>{error}</p>}

      {process.env.NEXT_PUBLIC_ANDROID_APK_URL && (
        <a
          href={process.env.NEXT_PUBLIC_ANDROID_APK_URL}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            marginTop: 20,
            padding: '10px 14px',
            border: '1px solid #2f7d32',
            borderRadius: 6,
            color: '#7cd47c',
            textDecoration: 'none',
            fontSize: 14,
          }}
          download
        >
          <span aria-hidden>🤖</span> Download the Android app
        </a>
      )}

      {/* Builds up to 2026-08-06 were signed with a debug key; releases are
          now signed with the real upload key. Android refuses to update an
          app across a signature change, so anyone holding an older build hits
          an install error that gives no hint as to why. This one-line note is
          cheaper than the support messages it prevents. Safe to delete once
          the app is distributed through Play. */}
      {process.env.NEXT_PUBLIC_ANDROID_APK_URL && (
        <p style={{ marginTop: 8, fontSize: 12, color: '#8a8a8a', textAlign: 'center' }}>
          Updating from an older build? Uninstall the app first, then install
          this one.
        </p>
      )}

      {process.env.NEXT_PUBLIC_IOS_APP_URL && (
        <a
          href={process.env.NEXT_PUBLIC_IOS_APP_URL}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            marginTop: 10,
            padding: '10px 14px',
            border: '1px solid #4a6f8a',
            borderRadius: 6,
            color: '#8ec3e6',
            textDecoration: 'none',
            fontSize: 14,
          }}
        >
          <span aria-hidden>🍎</span> Get the iPhone app (TestFlight)
        </a>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '10px 12px',
  marginBottom: 12,
  borderRadius: 4,
  border: '1px solid #333',
  background: '#17171c',
  color: 'white',
};
