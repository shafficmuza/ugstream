'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { getAccessToken } from '@/lib/auth';
import type { AppSettings } from '@/lib/settings';
import { labelStyle, inputStyle, uploadFile } from '../shared';

type FormState = Pick<
  AppSettings,
  'appName' | 'tagline' | 'supportEmail' | 'supportPhone' | 'logoUrl' | 'heroBackgroundUrl' | 'authBackgroundUrl'
> & { mobileMoneyProvider: string; smsProvider: string; maxSessions: number; maxStreams: number };

const SMS_OPTIONS: { value: string; label: string }[] = [
  { value: 'africastalking', label: "Africa's Talking" },
  { value: 'twilio', label: 'Twilio' },
];

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
    smsProvider: 'africastalking',
    maxSessions: 3,
    maxStreams: 2,
  });
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [methods, setMethods] = useState<{ method: string; provider: string; enabled: boolean }[]>([]);
  const [credProviders, setCredProviders] = useState<{ provider: string; keys: { key: string; set: boolean }[] }[]>([]);
  const [smsProviders, setSmsProviders] = useState<{ provider: string; keys: { key: string; set: boolean }[] }[]>([]);
  const [smsInputs, setSmsInputs] = useState<Record<string, string>>({});
  const [savingSms, setSavingSms] = useState(false);
  const [credInputs, setCredInputs] = useState<Record<string, string>>({});
  const [savingCreds, setSavingCreds] = useState(false);
  const [savingLimits, setSavingLimits] = useState(false);

  function loadSmsCredentials() {
    const token = getAccessToken();
    if (!token) return;
    apiFetch<{ providers: { provider: string; keys: { key: string; set: boolean }[] }[] }>('/admin/sms-credentials', { token })
      .then((r) => setSmsProviders(r.providers))
      .catch(() => setSmsProviders([]));
  }

  async function saveSmsProvider(provider: string) {
    const token = getAccessToken();
    if (!token) return;
    setForm((f) => ({ ...f, smsProvider: provider }));
    setMessage(null);
    try {
      await apiFetch('/admin/settings', { method: 'PATCH', token, body: { smsProvider: provider } });
      setMessage('SMS provider updated.');
    } catch (e: any) {
      setMessage(e.message ?? 'Failed to update SMS provider.');
    }
  }

  async function saveSmsCredentials() {
    const token = getAccessToken();
    if (!token) return;
    const values = Object.fromEntries(Object.entries(smsInputs).filter(([, v]) => v.trim() !== ''));
    if (Object.keys(values).length === 0) {
      setMessage('Nothing to save — type a value into a field first.');
      return;
    }
    setSavingSms(true);
    setMessage(null);
    try {
      await apiFetch('/admin/sms-credentials', { method: 'POST', token, body: { values } });
      setSmsInputs({});
      setMessage('SMS credentials saved.');
      loadSmsCredentials();
    } catch (e: any) {
      setMessage(e.message ?? 'Failed to save SMS credentials.');
    } finally {
      setSavingSms(false);
    }
  }

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
        smsProvider: settings.smsProvider ?? 'africastalking',
        maxSessions: settings.maxSessions ?? 3,
        maxStreams: settings.maxStreams ?? 2,
      });
      setLoaded(true);
    });
    const token = getAccessToken();
    if (token) {
      apiFetch<{ methods: { method: string; provider: string; enabled: boolean }[] }>('/payments/methods', { token })
        .then((r) => setMethods(r.methods))
        .catch(() => setMethods([]));
      loadCredentials();
      loadSmsCredentials();
    }
  }, []);

  async function saveLimits() {
    const token = getAccessToken();
    if (!token) return;
    setSavingLimits(true);
    setMessage(null);
    try {
      await apiFetch('/admin/settings', {
        method: 'PATCH',
        token,
        body: { maxSessions: form.maxSessions, maxStreams: form.maxStreams },
      });
      setMessage('Sharing limits updated.');
    } catch (e: any) {
      setMessage(e.message ?? 'Failed to update limits.');
    } finally {
      setSavingLimits(false);
    }
  }

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

      <h2 style={{ fontSize: 16, marginTop: 32, marginBottom: 4 }}>Account sharing limits</h2>
      <p style={{ opacity: 0.6, fontSize: 13, marginBottom: 16 }}>
        Set <b>0</b> for unlimited. Changes apply immediately — signed-in devices are not
        disconnected, but the next sign-in or play request is judged against the new number.
      </p>

      <label style={labelStyle}>Devices signed in at once</label>
      <input
        style={inputStyle}
        type="number"
        min={0}
        max={20}
        value={form.maxSessions}
        onChange={(e) => setForm((f) => ({ ...f, maxSessions: Number(e.target.value) }))}
      />
      <p style={{ opacity: 0.5, fontSize: 12, marginTop: 4, marginBottom: 12 }}>
        Signing in past this limit signs out the device that has been idle longest, rather
        than refusing the login — so a lost or replaced phone can never lock someone out of
        their own account.
      </p>

      <label style={labelStyle}>Simultaneous streams</label>
      <input
        style={inputStyle}
        type="number"
        min={0}
        max={20}
        value={form.maxStreams}
        onChange={(e) => setForm((f) => ({ ...f, maxStreams: Number(e.target.value) }))}
      />
      <p style={{ opacity: 0.5, fontSize: 12, marginTop: 4, marginBottom: 12 }}>
        How many devices may play at the same time. Kept separate from the sign-in limit on
        purpose: a household kept signed in on five devices may still only ever watch on two.
        A device that stops playing frees its slot within a minute.
      </p>

      <button
        className="btn"
        style={{ width: '100%', marginBottom: 8 }}
        onClick={saveLimits}
        disabled={savingLimits}
      >
        {savingLimits ? 'Saving…' : 'Save sharing limits'}
      </button>

      <h2 style={{ fontSize: 16, marginTop: 32, marginBottom: 4 }}>SMS / OTP gateway</h2>
      <p style={{ opacity: 0.6, fontSize: 13, marginBottom: 16 }}>
        Which gateway sends login codes. Configuring it <b>disables the test bypass code</b> and
        switches login to real SMS codes. Credentials are stored securely and never shown back.
      </p>

      <label style={labelStyle}>SMS provider</label>
      <select style={inputStyle} value={form.smsProvider} onChange={(e) => saveSmsProvider(e.target.value)}>
        {SMS_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      {smsProviders
        .filter((p) => p.provider === form.smsProvider)
        .map((p) => (
          <div key={p.provider} style={{ border: '1px solid #2a2a2a', borderRadius: 6, padding: '12px 14px', marginTop: 12, marginBottom: 12 }}>
            {p.keys.map((k) => (
              <div key={k.key} style={{ marginBottom: 8 }}>
                <label style={{ ...labelStyle, display: 'flex', justifyContent: 'space-between' }}>
                  <span>{k.key}</span>
                  <span style={{ fontSize: 11, color: k.set ? '#3ddc84' : '#ffb020' }}>{k.set ? 'set' : 'not set'}</span>
                </label>
                <input
                  style={inputStyle}
                  type={k.key.endsWith('_ENV') ? 'text' : 'password'}
                  autoComplete="new-password"
                  placeholder={k.set ? '•••••••• (leave blank to keep)' : k.key.endsWith('_ENV') ? 'production' : 'not set'}
                  value={smsInputs[k.key] ?? ''}
                  onChange={(e) => setSmsInputs((c) => ({ ...c, [k.key]: e.target.value }))}
                />
              </div>
            ))}
          </div>
        ))}

      {smsProviders.length > 0 && (
        <button className="btn" style={{ width: '100%', marginBottom: 8 }} onClick={saveSmsCredentials} disabled={savingSms}>
          {savingSms ? 'Saving…' : 'Save SMS credentials'}
        </button>
      )}

      {message && <p style={{ marginTop: 12, opacity: 0.8 }}>{message}</p>}
    </div>
  );
}
