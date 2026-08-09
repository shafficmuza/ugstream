'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { getAccessToken } from '@/lib/auth';
import { useAuth } from '@/lib/auth-context';
import { tableStyle, thStyle, tdStyle } from '../shared';

interface AdminTitle {
  id: string;
  name: string;
  kind: string;
  access: string;
  published: boolean;
  episodeCount: number;
}

export default function AdminTitlesPage() {
  const { me } = useAuth();
  const isAdmin = me?.role === 'admin';
  const [titles, setTitles] = useState<AdminTitle[] | null>(null);
  const [query, setQuery] = useState('');

  // Filtered in the browser rather than by a round trip: the list endpoint
  // already returns every title, so this is instant on each keystroke and
  // costs the API nothing. Matches name, kind and access so "series",
  // "draft-ish" filtering by type works from the same box.
  const visible = useMemo(() => {
    if (!titles) return null;
    const q = query.trim().toLowerCase();
    if (!q) return titles;
    return titles.filter((t) =>
      [t.name, t.kind, t.access].some((f) => f?.toLowerCase().includes(q)),
    );
  }, [titles, query]);

  function load() {
    const token = getAccessToken();
    if (!token) return;
    apiFetch<AdminTitle[]>('/admin/titles', { token }).then(setTitles);
  }

  useEffect(load, []);

  async function togglePublish(t: AdminTitle) {
    const token = getAccessToken();
    if (!token) return;
    await apiFetch(`/admin/titles/${t.id}/publish`, {
      method: 'PATCH',
      token,
      body: { published: !t.published },
    });
    load();
  }

  async function remove(t: AdminTitle) {
    if (!confirm(`Delete "${t.name}"? This cannot be undone.`)) return;
    const token = getAccessToken();
    if (!token) return;
    await apiFetch(`/admin/titles/${t.id}`, { method: 'DELETE', token });
    load();
  }

  if (!titles || !visible) return <p>Loading…</p>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h1 style={{ fontSize: 22 }}>
          Titles
          <span style={{ opacity: 0.5, fontSize: 14, fontWeight: 400, marginLeft: 8 }}>
            {query.trim() ? `${visible.length} of ${titles.length}` : titles.length}
          </span>
        </h1>
        <Link href="/admin/titles/new" className="btn">
          + New title
        </Link>
      </div>

      <div style={{ position: 'relative', marginBottom: 16 }}>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search titles by name, kind or access…"
          aria-label="Search titles"
          autoFocus
          style={{
            width: '100%',
            padding: '10px 12px',
            background: '#1a1a1a',
            border: '1px solid #333',
            borderRadius: 6,
            color: '#eee',
            fontSize: 14,
          }}
        />
      </div>

      <div className="table-wrap">
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={thStyle}>Name</th>
            <th style={thStyle}>Kind</th>
            <th style={thStyle}>Access</th>
            <th style={thStyle}>Episodes</th>
            <th style={thStyle}>Published</th>
            <th style={thStyle}></th>
          </tr>
        </thead>
        <tbody>
          {visible.map((t) => (
            <tr key={t.id}>
              <td style={tdStyle}>
                <Link href={`/admin/titles/${t.id}/edit`}>{t.name}</Link>
              </td>
              <td style={tdStyle}>{t.kind}</td>
              <td style={tdStyle}>{t.access}</td>
              <td style={tdStyle}>{t.episodeCount}</td>
              <td style={tdStyle}>
                <button className="btn" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => togglePublish(t)}>
                  {t.published ? 'Published' : 'Draft'}
                </button>
              </td>
              <td style={tdStyle}>
                {isAdmin && (
                  <button
                    onClick={() => remove(t)}
                    style={{ background: 'none', border: 'none', color: '#ff6b6b', cursor: 'pointer' }}
                  >
                    Delete
                  </button>
                )}
              </td>
            </tr>
          ))}
          {visible.length === 0 && (
            <tr>
              <td style={tdStyle} colSpan={6}>
                {titles.length === 0 ? 'No titles yet.' : `No titles match “${query.trim()}”.`}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      </div>
    </div>
  );
}
