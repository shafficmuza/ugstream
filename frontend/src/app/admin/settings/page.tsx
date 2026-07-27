'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { getAccessToken } from '@/lib/auth';
import type { AppSettings } from '@/lib/settings';
import { labelStyle, inputStyle, uploadFile } from '../shared';

type FormState = Pick<
  AppSettings,
  'appName' | 'tagline' | 'supportEmail' | 'supportPhone' | 'logoUrl' | 'heroBackgroundUrl' | 'authBackgroundUrl'
> & { mobileMoneyProvider: string };

const MOBILE_MONEY_OPTIONS: { value: string; label: string }[] = [
  { value: 'momo', label: 'MTN Mobile Money (direct)' },
  { value: 'flutterwave', label: 'Flutterwave' },
  { value: 'yo', label: 'Yo! Payments' },
  { value: 'dpo', label: 'DPO Pay' },
];

export default function AdminSettingsPage() {
  const [form, setForm] = useState<FormState>({
    appName: '',
    tagline: '',
    supportEmail: '',
    supportPhone: '',
    logoUrl: null,
    heroBackgroundUrl: null,
    authBackgroundUrl: null,
    mobileMoneyProvider: 'momo',
  });
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [methods, setMethods] = useState<{ method: string; provider: string; enabled: boolean }[]>([]);

  useEffect(() => {
    apiFetch<AppSettings>('/settings').then((settings) => {
      setForm({
        appName: settings.appName,
        tagline: settings.tagline ?? '',
        supportEmail: settings.supportEmail ?? '',
        supportPhone: settings.supportPhone ?? '',
        logoUrl: settings.logoUrl,
        heroBackgroundUrl: settings.heroBackgroundUrl,
        authBackgroundUrl: settings.authBackgroundUrl,
        mobileMoneyProvider: settings.mobileMoneyProvider ?? 'momo',
      });
      setLoaded(true);
    });
    const token = getAccessToken();
    if (token) {
      apiFetch<{ methods: { method: string; provider: string; enabled: boolean }[] }>('/payments/methods', { token })
        .then((r) => setMethods(r.methods))
        .catch(() => setMethods([]));
    }
  }, []);

  async function saveProvider(provider: string) {
    const token = getAccessToken();
    if (!token) return;
    setForm((f) => ({ ...f, mobileMoneyProvider: provider }));
    setMessage(null);
    try {
      await apiFetch('/admin/settings', { method: 'PATCH', token, body: { mobileMoneyProvider: provider } });
      setMessage('Mobile money provider updated.');
      const r = await apiFetch<{ methods: { method: string; provider: string; enabled: boolean }[] }>('/payments/methods', { token });
      setMethods(r.methods);
    } catch (e: any) {
      setMessage(e.message ?? 'Failed to update provider.');
    }
  }

  async function uploadImage(field: 'logoUrl' | 'heroBackgroundUrl' | 'authBackgroundUrl', endpoint: string, file: File) {
    setUploading(field);
    setMessage(null);
    try {
      const res = await uploadFile(endpoint, file);
      const url = res.logoUrl ?? res.heroBackgroundUrl ?? res.authBackgroundUrl;
      setForm((f) => ({ ...f, [field]: url }));
      setMessage('Uploaded.');
    } catch (e: any) {
      setMessage(e.message ?? 'Upload failed.');
    } finally {
      setUploading(null);
    }
  }

  async function save(e?: React.FormEvent) {
    e?.preventDefault();
    const token = getAccessToken();
    if (!token) return;
    setSaving(true);
    setMessage(null);
    try {
      await apiFetch('/admin/settings', {
        method: 'PATCH',
        token,
        body: {
          appName: form.appName,
          tagline: form.tagline || undefined,
          supportEmail: form.supportEmail || undefined,
          supportPhone: form.supportPhone || undefined,
        },
      });
      setMessage('Saved.');
    } catch (e: any) {
      setMessage(e.message ?? 'Failed to save.');
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) return <p>Loading…</p>;

  return (
    <div style={{ maxWidth: 480 }}>
      <h1 style={{ fontSize: 22, marginBottom: 24 }}>Company details</h1>

      <label style={labelStyle}>Logo</label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        {form.logoUrl && <img src={form.logoUrl} alt="Logo" style={{ height: 40 }} />}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          disabled={uploading === 'logoUrl'}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) uploadImage('logoUrl', '/admin/settings/logo', file);
          }}
        />
      </div>

      <form onSubmit={save}>
        <label style={labelStyle}>App name</label>
        <input
          style={inputStyle}
          value={form.appName}
          onChange={(e) => setForm((f) => ({ ...f, appName: e.target.value }))}
        />

        <label style={labelStyle}>Tagline</label>
        <input
          style={inputStyle}
          value={form.tagline ?? ''}
          onChange={(e) => setForm((f) => ({ ...f, tagline: e.target.value }))}
        />

        <label style={labelStyle}>Support email</label>
        <input
          style={inputStyle}
          type="email"
          value={form.supportEmail ?? ''}
          onChange={(e) => setForm((f) => ({ ...f, supportEmail: e.target.value }))}
        />

        <label style={labelStyle}>Support phone</label>
        <input
          style={inputStyle}
          value={form.supportPhone ?? ''}
          onChange={(e) => setForm((f) => ({ ...f, supportPhone: e.target.value }))}
        />

        <button className="btn" style={{ width: '100%', marginTop: 8, marginBottom: 32 }} type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </form>

      <h2 style={{ fontSize: 16, marginBottom: 4 }}>Background art</h2>
      <p style={{ opacity: 0.6, fontSize: 13, marginBottom: 16 }}>
        Takes effect immediately — no save button needed, upload replaces it right away.
      </p>

      <label style={labelStyle}>Homepage hero background</label>
      <div style={{ marginBottom: 16 }}>
        {form.heroBackgroundUrl && (
          <img src={form.heroBackgroundUrl} alt="" style={{ width: '100%', maxHeight: 120, objectFit: 'cover', borderRadius: 4, marginBottom: 8 }} />
        )}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={uploading === 'heroBackgroundUrl'}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) uploadImage('heroBackgroundUrl', '/admin/settings/hero-background', file);
          }}
        />
      </div>

      <label style={labelStyle}>Login page background</label>
      <div style={{ marginBottom: 16 }}>
        {form.authBackgroundUrl && (
          <img src={form.authBackgroundUrl} alt="" style={{ width: '100%', maxHeight: 120, objectFit: 'cover', borderRadius: 4, marginBottom: 8 }} />
        )}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={uploading === 'authBackgroundUrl'}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) uploadImage('authBackgroundUrl', '/admin/settings/auth-background', file);
          }}
        />
      </div>

      <h2 style={{ fontSize: 16, marginTop: 32, marginBottom: 4 }}>Payments</h2>
      <p style={{ opacity: 0.6, fontSize: 13, marginBottom: 16 }}>
        Card payments always use <b>Stripe</b>. Choose which processor handles <b>mobile money</b> —
        takes effect immediately. Each provider&apos;s API credentials are set in the server&apos;s
        environment (<code>.env</code>), not here.
      </p>

      <label style={labelStyle}>Mobile money provider</label>
      <select
        style={inputStyle}
        value={form.mobileMoneyProvider}
        onChange={(e) => saveProvider(e.target.value)}
      >
        {MOBILE_MONEY_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      <div style={{ marginTop: 12, marginBottom: 8 }}>
        {methods.map((m) => (
          <div key={m.method} style={{ fontSize: 13, marginBottom: 4 }}>
            <span style={{ opacity: 0.7, textTransform: 'capitalize' }}>{m.method.replace('_', ' ')}:</span>{' '}
            <b>{m.provider}</b>{' '}
            <span style={{ color: m.enabled ? '#3ddc84' : '#ffb020' }}>
              {m.enabled ? '● credentials set' : '● credentials missing (set in .env)'}
            </span>
          </div>
        ))}
      </div>

      {message && <p style={{ marginTop: 12, opacity: 0.8 }}>{message}</p>}
    </div>
  );
}
