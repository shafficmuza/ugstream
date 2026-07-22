'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { getAccessToken } from '@/lib/auth';
import { tableStyle, thStyle, tdStyle, inputStyle, labelStyle } from '../shared';

interface Plan {
  id: number;
  name: string;
  priceUgx: number;
  durationDays: number;
  active: boolean;
}

export default function AdminPlansPage() {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [form, setForm] = useState({ name: '', priceUgx: '', durationDays: '' });
  const [error, setError] = useState<string | null>(null);

  function load() {
    const token = getAccessToken();
    if (!token) return;
    apiFetch<Plan[]>('/admin/plans', { token }).then(setPlans);
  }

  useEffect(load, []);

  async function create() {
    const token = getAccessToken();
    if (!token || !form.name || !form.priceUgx || !form.durationDays) return;
    setError(null);
    try {
      await apiFetch('/admin/plans', {
        method: 'POST',
        token,
        body: {
          name: form.name,
          priceUgx: parseInt(form.priceUgx, 10),
          durationDays: parseInt(form.durationDays, 10),
        },
      });
      setForm({ name: '', priceUgx: '', durationDays: '' });
      load();
    } catch (e: any) {
      setError(e.message ?? 'Failed to create plan.');
    }
  }

  async function toggleActive(p: Plan) {
    const token = getAccessToken();
    if (!token) return;
    await apiFetch(`/admin/plans/${p.id}`, { method: 'PATCH', token, body: { active: !p.active } });
    load();
  }

  if (!plans) return <p>Loading…</p>;

  return (
    <div>
      <h1 style={{ fontSize: 22, marginBottom: 24 }}>Subscription plans</h1>

      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', maxWidth: 500, marginBottom: 24 }}>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>Name</label>
          <input style={inputStyle} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div style={{ width: 120 }}>
          <label style={labelStyle}>Price (UGX)</label>
          <input style={inputStyle} value={form.priceUgx} onChange={(e) => setForm({ ...form, priceUgx: e.target.value })} />
        </div>
        <div style={{ width: 100 }}>
          <label style={labelStyle}>Days</label>
          <input style={inputStyle} value={form.durationDays} onChange={(e) => setForm({ ...form, durationDays: e.target.value })} />
        </div>
        <button className="btn" style={{ marginBottom: 16 }} onClick={create}>
          Add
        </button>
      </div>
      {error && <p style={{ color: '#ff6b6b', marginBottom: 12 }}>{error}</p>}

      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={thStyle}>Name</th>
            <th style={thStyle}>Price</th>
            <th style={thStyle}>Duration</th>
            <th style={thStyle}>Active</th>
          </tr>
        </thead>
        <tbody>
          {plans.map((p) => (
            <tr key={p.id}>
              <td style={tdStyle}>{p.name}</td>
              <td style={tdStyle}>UGX {p.priceUgx.toLocaleString()}</td>
              <td style={tdStyle}>{p.durationDays} days</td>
              <td style={tdStyle}>
                <button className="btn" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => toggleActive(p)}>
                  {p.active ? 'Active' : 'Inactive'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
