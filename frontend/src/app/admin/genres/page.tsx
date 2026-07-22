'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { getAccessToken } from '@/lib/auth';
import { tableStyle, thStyle, tdStyle, inputStyle, labelStyle } from '../shared';

interface Genre {
  id: number;
  name: string;
  slug: string;
  titleCount: number;
}

function slugify(name: string) {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

export default function AdminGenresPage() {
  const [genres, setGenres] = useState<Genre[] | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  function load() {
    const token = getAccessToken();
    if (!token) return;
    apiFetch<Genre[]>('/admin/genres', { token }).then(setGenres);
  }

  useEffect(load, []);

  async function create() {
    const token = getAccessToken();
    if (!token || !name.trim()) return;
    setError(null);
    try {
      await apiFetch('/admin/genres', { method: 'POST', token, body: { name, slug: slugify(name) } });
      setName('');
      load();
    } catch (e: any) {
      setError(e.message ?? 'Failed to create genre.');
    }
  }

  async function remove(g: Genre) {
    if (g.titleCount > 0 && !confirm(`"${g.name}" is used by ${g.titleCount} title(s). Remove anyway?`)) return;
    const token = getAccessToken();
    if (!token) return;
    await apiFetch(`/admin/genres/${g.id}`, { method: 'DELETE', token });
    load();
  }

  if (!genres) return <p>Loading…</p>;

  return (
    <div>
      <h1 style={{ fontSize: 22, marginBottom: 24 }}>Genres</h1>

      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', maxWidth: 400, marginBottom: 24 }}>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>New genre name</label>
          <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} />
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
            <th style={thStyle}>Slug</th>
            <th style={thStyle}>Titles</th>
            <th style={thStyle}></th>
          </tr>
        </thead>
        <tbody>
          {genres.map((g) => (
            <tr key={g.id}>
              <td style={tdStyle}>{g.name}</td>
              <td style={tdStyle}>{g.slug}</td>
              <td style={tdStyle}>{g.titleCount}</td>
              <td style={tdStyle}>
                <button onClick={() => remove(g)} style={{ background: 'none', border: 'none', color: '#ff6b6b', cursor: 'pointer' }}>
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
