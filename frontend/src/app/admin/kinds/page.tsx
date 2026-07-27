'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { getAccessToken } from '@/lib/auth';
import { useAuth } from '@/lib/auth-context';
import { tableStyle, thStyle, tdStyle, inputStyle, labelStyle } from '../shared';

interface Kind {
  id: number;
  name: string;
  slug: string;
  sortOrder: number;
  titleCount: number;
}

function slugify(name: string) {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

export default function AdminKindsPage() {
  const { me } = useAuth();
  const isAdmin = me?.role === 'admin';
  const [kinds, setKinds] = useState<Kind[] | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  function load() {
    const token = getAccessToken();
    if (!token) return;
    apiFetch<Kind[]>('/admin/kinds', { token }).then(setKinds);
  }

  useEffect(load, []);

  async function create(e?: React.FormEvent) {
    e?.preventDefault();
    const token = getAccessToken();
    if (!token || !name.trim()) return;
    setError(null);
    try {
      const sortOrder = (kinds?.length ?? 0) * 10;
      await apiFetch('/admin/kinds', {
        method: 'POST',
        token,
        body: { name: name.trim(), slug: slugify(name), sortOrder },
      });
      setName('');
      load();
    } catch (e: any) {
      setError(e.message ?? 'Failed to create kind.');
    }
  }

  async function remove(k: Kind) {
    setError(null);
    if (!confirm(`Delete kind "${k.name}"?`)) return;
    const token = getAccessToken();
    if (!token) return;
    try {
      await apiFetch(`/admin/kinds/${k.id}`, { method: 'DELETE', token });
      load();
    } catch (e: any) {
      setError(e.message ?? 'Failed to delete kind.');
    }
  }

  if (!kinds) return <p>Loading…</p>;

  return (
    <div>
      <h1 style={{ fontSize: 22, marginBottom: 8 }}>Kinds</h1>
      <p style={{ opacity: 0.7, fontSize: 13, marginBottom: 24, maxWidth: 560 }}>
        Content types a title can be (Movie, Series, Documentary, Music, Kids…). These populate the
        Kind dropdown when creating or editing a title.
      </p>

      <form
        onSubmit={create}
        style={{ display: 'flex', gap: 12, alignItems: 'flex-end', maxWidth: 400, marginBottom: 24 }}
      >
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>New kind name</label>
          <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <button className="btn" style={{ marginBottom: 16 }} type="submit">
          Add
        </button>
      </form>
      {error && <p style={{ color: '#ff6b6b', marginBottom: 12 }}>{error}</p>}

      <div className="table-wrap">
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Name</th>
              <th style={thStyle}>Slug</th>
              <th style={thStyle}>Titles</th>
              <th style={thStyle}></th>
            </tr>
          </thead>
          <tbody>
            {kinds.map((k) => (
              <tr key={k.id}>
                <td style={tdStyle}>{k.name}</td>
                <td style={tdStyle}>{k.slug}</td>
                <td style={tdStyle}>{k.titleCount}</td>
                <td style={tdStyle}>
                  {isAdmin && (
                    <button
                      onClick={() => remove(k)}
                      disabled={k.titleCount > 0}
                      title={k.titleCount > 0 ? 'Reassign its titles before deleting' : 'Delete'}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: k.titleCount > 0 ? '#666' : '#ff6b6b',
                        cursor: k.titleCount > 0 ? 'not-allowed' : 'pointer',
                      }}
                    >
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
