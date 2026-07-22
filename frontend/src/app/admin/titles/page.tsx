'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { getAccessToken } from '@/lib/auth';
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
  const [titles, setTitles] = useState<AdminTitle[] | null>(null);

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

  if (!titles) return <p>Loading…</p>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h1 style={{ fontSize: 22 }}>Titles</h1>
        <Link href="/admin/titles/new" className="btn">
          + New title
        </Link>
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
          {titles.map((t) => (
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
                <button
                  onClick={() => remove(t)}
                  style={{ background: 'none', border: 'none', color: '#ff6b6b', cursor: 'pointer' }}
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
          {titles.length === 0 && (
            <tr>
              <td style={tdStyle} colSpan={6}>
                No titles yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      </div>
    </div>
  );
}
