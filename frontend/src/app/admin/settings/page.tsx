'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { getAccessToken } from '@/lib/auth';
import type { AppSettings } from '@/lib/settings';
import { labelStyle, inputStyle, uploadFile } from '../shared';

type FormState = Pick<AppSettings, 'appName' | 'tagline' | 'supportEmail' | 'supportPhone'> & {
  logoUrl: string | null;
};

export default function AdminSettingsPage() {
  const [form, setForm] = useState<FormState>({
    appName: '',
    tagline: '',
    supportEmail: '',
    supportPhone: '',
    logoUrl: null,
  });
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<AppSettings>('/settings').then((settings) => {
      setForm({
        appName: settings.appName,
        tagline: settings.tagline ?? '',
        supportEmail: settings.supportEmail ?? '',
        supportPhone: settings.supportPhone ?? '',
        logoUrl: settings.logoUrl,
      });
      setLoaded(true);
    });
  }, []);

  async function uploadLogo(file: File) {
    setUploading(true);
    setMessage(null);
    try {
      const { logoUrl } = await uploadFile('/admin/settings/logo', file);
      setForm((f) => ({ ...f, logoUrl }));
      setMessage('Logo uploaded.');
    } catch (e: any) {
      setMessage(e.message ?? 'Upload failed.');
    } finally {
      setUploading(false);
    }
  }

  async function save() {
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        {form.logoUrl && <img src={form.logoUrl} alt="Logo" style={{ height: 40 }} />}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          disabled={uploading}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) uploadLogo(file);
          }}
        />
      </div>

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
        value={form.supportEmail ?? ''}
        onChange={(e) => setForm((f) => ({ ...f, supportEmail: e.target.value }))}
      />

      <label style={labelStyle}>Support phone</label>
      <input
        style={inputStyle}
        value={form.supportPhone ?? ''}
        onChange={(e) => setForm((f) => ({ ...f, supportPhone: e.target.value }))}
      />

      <button className="btn" style={{ width: '100%', marginTop: 8 }} onClick={save} disabled={saving}>
        {saving ? 'Saving…' : 'Save changes'}
      </button>

      {message && <p style={{ marginTop: 12, opacity: 0.8 }}>{message}</p>}
    </div>
  );
}
