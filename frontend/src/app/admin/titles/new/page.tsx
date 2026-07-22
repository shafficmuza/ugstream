'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { getAccessToken } from '@/lib/auth';
import { TitleForm, emptyTitleForm, toUpsertPayload, TitleFormValues } from '../title-form';

export default function NewTitlePage() {
  const router = useRouter();
  const [form, setForm] = useState<TitleFormValues>(emptyTitleForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const token = getAccessToken();
    if (!token) return;
    setSaving(true);
    setError(null);
    try {
      const created = await apiFetch<{ id: string }>('/admin/titles', {
        method: 'POST',
        token,
        body: toUpsertPayload(form),
      });
      router.push(`/admin/titles/${created.id}/edit`);
    } catch (e: any) {
      setError(e.message ?? 'Failed to create title.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h1 style={{ fontSize: 22, marginBottom: 24 }}>New title</h1>
      <TitleForm value={form} onChange={setForm} />
      <button className="btn" onClick={save} disabled={saving || !form.name || !form.slug}>
        {saving ? 'Creating…' : 'Create title'}
      </button>
      {error && <p style={{ color: '#ff6b6b', marginTop: 12 }}>{error}</p>}
    </div>
  );
}
