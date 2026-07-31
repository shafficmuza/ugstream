'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { getAccessToken } from '@/lib/auth';
import { useAuth } from '@/lib/auth-context';

export default function ProfilePage() {
  const router = useRouter();
  const params = useSearchParams();
  const { me, refresh } = useAuth();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mustSetName = params.get('required') === '1' || (me && !me.displayName);

  useEffect(() => {
    if (me === null) {
      router.push('/login');
      return;
    }
    if (me) {
      setDisplayName(me.displayName ?? '');
      setEmail(me.email ?? '');
      setAddress(me.address ?? '');
    }
  }, [me, router]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const token = getAccessToken();
    if (!token) return;
    if (!displayName.trim()) {
      setError('Please enter your name — it is required.');
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await apiFetch('/me', {
        method: 'PATCH',
        token,
        body: {
          displayName: displayName.trim(),
          email: email.trim() || undefined,
          address: address.trim() || undefined,
        },
      });
      await refresh();
      setMessage('Saved.');
      if (mustSetName) router.push('/');
    } catch (e: any) {
      setError(e.message ?? 'Failed to save.');
    } finally {
      setSaving(false);
    }
  }

  if (me === undefined) return <main style={{ padding: 40 }}>Loading…</main>;

  const label: React.CSSProperties = { display: 'block', fontSize: 13, opacity: 0.75, marginBottom: 6, marginTop: 16 };
  const input: React.CSSProperties = {
    width: '100%', padding: '10px 12px', borderRadius: 6,
    border: '1px solid #333', background: '#1a1a1a', color: '#fff', fontSize: 15,
  };

  return (
    <main style={{ maxWidth: 460, margin: '80px auto', padding: '0 20px' }}>
      <h1 style={{ fontSize: 22, marginBottom: 6 }}>Your profile</h1>
      {mustSetName ? (
        <p style={{ color: '#ffb020', fontSize: 14, marginBottom: 8 }}>
          Please add your name to finish setting up your account.
        </p>
      ) : (
        <p style={{ opacity: 0.7, fontSize: 14, marginBottom: 8 }}>
          Update your details. Only your name is required.
        </p>
      )}

      <form onSubmit={save}>
        <label style={label}>Phone (login)</label>
        <input style={{ ...input, opacity: 0.6 }} value={me?.phone ?? ''} disabled />

        <label style={label}>
          Name <span style={{ color: '#e50914' }}>*</span>
        </label>
        <input style={input} value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Your name" />

        <label style={label}>Email (optional)</label>
        <input style={input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />

        <label style={label}>Address (optional)</label>
        <input style={input} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Your address" />

        {error && <p style={{ color: '#ff6b6b', marginTop: 12 }}>{error}</p>}
        {message && <p style={{ color: '#3ddc84', marginTop: 12 }}>{message}</p>}

        <button className="btn" style={{ width: '100%', marginTop: 20 }} type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </form>
    </main>
  );
}
