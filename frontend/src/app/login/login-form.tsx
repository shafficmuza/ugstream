'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

export function LoginForm() {
  const router = useRouter();
  const { login } = useAuth();
  const [phone, setPhone] = useState('+256');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function requestOtp(e?: React.FormEvent) {
    e?.preventDefault();
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
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+256700000000"
            type="tel"
            autoFocus
            style={inputStyle}
          />
          <button className="btn" style={{ width: '100%' }} type="submit" disabled={loading}>
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
