'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();
  const [phone, setPhone] = useState('+256');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function requestOtp() {
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

  async function verifyOtp() {
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
    <main style={{ maxWidth: 360, margin: '80px auto', padding: '0 20px' }}>
      <h1 style={{ fontSize: 22 }}>Log in</h1>

      {step === 'phone' && (
        <>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+256700000000"
            style={inputStyle}
          />
          <button className="btn" style={{ width: '100%' }} onClick={requestOtp} disabled={loading}>
            {loading ? 'Sending…' : 'Send code'}
          </button>
        </>
      )}

      {step === 'code' && (
        <>
          <p style={{ opacity: 0.7, fontSize: 14 }}>Enter the 6-digit code sent to {phone}</p>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="123456"
            maxLength={6}
            style={inputStyle}
          />
          <button className="btn" style={{ width: '100%' }} onClick={verifyOtp} disabled={loading}>
            {loading ? 'Verifying…' : 'Verify & continue'}
          </button>
        </>
      )}

      {error && <p style={{ color: '#ff6b6b', marginTop: 12 }}>{error}</p>}
    </main>
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
