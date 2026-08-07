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
  const [pin, setPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [step, setStep] = useState<'phone' | 'code' | 'pin' | 'set-pin'>('phone');
  // Tokens from a sign-in held back while the user chooses a PIN, so the
  // prompt cannot be dismissed by navigating away with a half-finished
  // session — either they set one or they skip, and both land signed in.
  const [pending, setPending] = useState<{ accessToken: string; refreshToken: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // E.164 assembled from the country and the national part, or null while the
  // number is incomplete. Kept in one place so what is displayed on the code
  // screen is exactly what was sent.
  const phone = composePhone(country, national);

  /**
   * From the phone screen, ask the server which step this number should see.
   * A number with a working PIN goes straight to it and no message is sent —
   * which is the whole saving: an SMS is spent once per account, not once per
   * sign-in.
   */
  async function continueFromPhone(e?: React.FormEvent) {
    e?.preventDefault();
    if (!phone) {
      setError('Enter your phone number.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { method } = await apiFetch<{ method: 'pin' | 'otp' }>('/auth/sign-in-method', {
        method: 'POST',
        body: { phone },
      });
      if (method === 'pin') {
        setStep('pin');
        return;
      }
      await sendCode();
    } catch (e: any) {
      setError(e.message ?? 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  }

  /** Request an SMS code. Separate so "send one anyway" can reuse it. */
  async function sendCode() {
    await apiFetch('/auth/otp/request', { method: 'POST', body: { phone } });
    setStep('code');
  }

  async function requestOtp(e?: React.FormEvent) {
    e?.preventDefault();
    if (!phone) {
      setError('Enter your phone number.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await sendCode();
    } catch (e: any) {
      setError(e.message ?? 'Failed to send code.');
    } finally {
      setLoading(false);
    }
  }

  async function signInWithPin(e?: React.FormEvent) {
    e?.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<{ accessToken: string; refreshToken: string }>('/auth/pin/login', {
        method: 'POST',
        body: { phone, pin, deviceLabel: navigator.userAgent.slice(0, 90) },
      });
      await login(res.accessToken, res.refreshToken);
      router.push('/');
    } catch (e: any) {
      setError(e.message ?? 'Incorrect PIN.');
    } finally {
      setLoading(false);
    }
  }

  async function savePin(e?: React.FormEvent) {
    e?.preventDefault();
    if (newPin !== confirmPin) {
      setError('The two PINs do not match.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await apiFetch('/auth/pin', { method: 'POST', token: pending!.accessToken, body: { pin: newPin } });
      await finishSignIn();
    } catch (e: any) {
      setError(e.message ?? 'Could not save your PIN.');
    } finally {
      setLoading(false);
    }
  }

  async function finishSignIn() {
    if (!pending) return;
    await login(pending.accessToken, pending.refreshToken);
    router.push('/');
  }

  async function verifyOtp(e?: React.FormEvent) {
    e?.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<{
        accessToken: string;
        refreshToken: string;
        user: { pinSet: boolean };
      }>('/auth/otp/verify', {
        method: 'POST',
        body: { phone, code, deviceLabel: navigator.userAgent.slice(0, 90) },
      });

      // Offered here and nowhere else, because this is the one moment the user
      // is certainly paying attention — and the only chance to make their next
      // sign-in cost nothing.
      if (!res.user?.pinSet) {
        setPending({ accessToken: res.accessToken, refreshToken: res.refreshToken });
        setStep('set-pin');
        return;
      }
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
        <form onSubmit={continueFromPhone}>
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
            {loading ? 'Please wait…' : 'Continue'}
          </button>
          {/*
            Consent language at the point of opt-in. Required for US A2P 10DLC
            registration: the screen where a number is entered has to state
            what will be sent and link to both policies, and reviewers check
            this screen specifically.
          */}
          {/*
            Someone who already holds a code needs a way past this screen
            without requesting another: a code read out by support, or an SMS
            that arrived after the page was reloaded. Without this the only
            route to the entry field is a fresh request, which the cooldown
            can refuse.
          */}
          <button
            type="button"
            onClick={() => {
              if (!phone) {
                setError('Enter your phone number first.');
                return;
              }
              setError(null);
              setStep('code');
            }}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              marginTop: 12,
              cursor: 'pointer',
              color: 'inherit',
              opacity: 0.6,
              fontSize: 12.5,
              textDecoration: 'underline',
            }}
          >
            I already have a code
          </button>
          <p style={{ opacity: 0.5, fontSize: 11.5, marginTop: 14, lineHeight: 1.5 }}>
            By continuing you agree to receive a one-time sign-in code by SMS. Message and data
            rates may apply. Reply STOP to opt out or HELP for help. See our{' '}
            <a href="/terms" style={{ color: 'inherit', textDecoration: 'underline' }}>
              Terms
            </a>{' '}
            and{' '}
            <a href="/privacy" style={{ color: 'inherit', textDecoration: 'underline' }}>
              Privacy Policy
            </a>
            .
          </p>
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

      {step === 'pin' && (
        <form onSubmit={signInWithPin}>
          <p style={{ opacity: 0.7, fontSize: 14 }}>Enter your PIN for {phone}</p>
          <input
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="••••"
            maxLength={8}
            inputMode="numeric"
            type="password"
            autoFocus
            style={inputStyle}
          />
          <button className="btn" style={{ width: '100%' }} type="submit" disabled={loading || pin.length < 4}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
          {/*
            The way back for a forgotten PIN. It costs a message, which is
            exactly why it is a quiet link rather than a second button — but it
            must always be present, or a forgotten PIN becomes a lost account.
          */}
          <button type="button" onClick={requestOtp} disabled={loading} style={linkButtonStyle}>
            Forgot your PIN? Get a code by SMS
          </button>
        </form>
      )}

      {step === 'set-pin' && (
        <form onSubmit={savePin}>
          <h2 style={{ fontSize: 16, marginBottom: 6 }}>Set a PIN</h2>
          <p style={{ opacity: 0.7, fontSize: 13.5, lineHeight: 1.55, marginBottom: 14 }}>
            Choose a PIN and you can sign in with it next time — no waiting for a text. You can
            change it later from your account, and you can always get a code by SMS instead.
          </p>
          <input
            value={newPin}
            onChange={(e) => setNewPin(e.target.value)}
            placeholder="New PIN (4–8 digits)"
            maxLength={8}
            inputMode="numeric"
            type="password"
            autoFocus
            style={inputStyle}
          />
          <input
            value={confirmPin}
            onChange={(e) => setConfirmPin(e.target.value)}
            placeholder="Confirm PIN"
            maxLength={8}
            inputMode="numeric"
            type="password"
            style={inputStyle}
          />
          <button
            className="btn"
            style={{ width: '100%' }}
            type="submit"
            disabled={loading || newPin.length < 4}
          >
            {loading ? 'Saving…' : 'Save PIN & continue'}
          </button>
          <button type="button" onClick={finishSignIn} disabled={loading} style={linkButtonStyle}>
            Skip for now
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

/** A button that reads as a link — used for the secondary way out of a step. */
const linkButtonStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  padding: 0,
  marginTop: 12,
  cursor: 'pointer',
  color: 'inherit',
  opacity: 0.6,
  fontSize: 12.5,
  textDecoration: 'underline',
};

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
