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
  const [credProviders, setCredProviders] = useState<{ provider: string; keys: { key: string; set: boolean }[] }[]>([]);
  const [credInputs, setCredInputs] = useState<Record<string, string>>({});
  const [savingCreds, setSavingCreds] = useState(false);

  function loadCredentials() {
    const token = getAccessToken();
    if (!token) return;
    apiFetch<{ providers: { provider: string; keys: { key: string; set: boolean }[] }[] }>('/admin/payments/credentials', { token })
      .then((r) => setCredProviders(r.providers))
      .catch(() => setCredProviders([]));
  }

  async function saveCredentials() {
    const token = getAccessToken();
    if (!token) return;
    const values = Object.fromEntries(Object.entries(credInputs).filter(([, v]) => v.trim() !== ''));
    if (Object.keys(values).length === 0) {
      setMessage('Nothing to save — type a value into a field first.');
      return;
    }
    setSavingCreds(true);
    setMessage(null);
    try {
      await apiFetch('/admin/payments/credentials', { method: 'POST', token, body: { values } });
      setCredInputs({});
      setMessage('Payment credentials saved.');
      loadCredentials();
      const r = await apiFetch<{ methods: typeof methods }>('/payments/methods', { token });
      setMethods(r.methods);
    } catch (e: any) {
      setMessage(e.message ?? 'Failed to save credentials.');
    } finally {
      setSavingCreds(false);
    }
  }

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
      loadCredentials();
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
              {m.enabled ? '● credentials set' : '● credentials missing'}
            </span>
          </div>
        ))}
      </div>

      <h3 style={{ fontSize: 14, marginTop: 24, marginBottom: 4 }}>Mobile money credentials</h3>
      <p style={{ opacity: 0.6, fontSize: 12.5, marginBottom: 14 }}>
        Enter each provider&apos;s API credentials here. Values are stored securely and never shown
        back — a field left blank keeps its current value. (Card/Stripe keys stay in the server
        environment by design.)
      </p>

      {credProviders.map((p) => (
        <div key={p.provider} style={{ border: '1px solid #2a2a2a', borderRadius: 6, padding: '12px 14px', marginBottom: 12 }}>
          <div style={{ fontWeight: 600, marginBottom: 8, textTransform: 'capitalize' }}>{p.provider}</div>
          {p.keys.map((k) => (
            <div key={k.key} style={{ marginBottom: 8 }}>
              <label style={{ ...labelStyle, display: 'flex', justifyContent: 'space-between' }}>
                <span>{k.key}</span>
                <span style={{ fontSize: 11, color: k.set ? '#3ddc84' : '#ffb020' }}>{k.set ? 'set' : 'not set'}</span>
              </label>
              <input
                style={inputStyle}
                type="password"
                autoComplete="new-password"
                placeholder={k.set ? '•••••••• (leave blank to keep)' : 'not set'}
                value={credInputs[k.key] ?? ''}
                onChange={(e) => setCredInputs((c) => ({ ...c, [k.key]: e.target.value }))}
              />
            </div>
          ))}
        </div>
      ))}

      {credProviders.length > 0 && (
        <button className="btn" style={{ width: '100%', marginBottom: 8 }} onClick={saveCredentials} disabled={savingCreds}>
          {savingCreds ? 'Saving…' : 'Save payment credentials'}
        </button>
      )}

      {message && <p style={{ marginTop: 12, opacity: 0.8 }}>{message}</p>}
    </div>
  );
}
