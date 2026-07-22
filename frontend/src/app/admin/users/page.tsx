'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { getAccessToken } from '@/lib/auth';
import { tableStyle, thStyle, tdStyle } from '../shared';

interface AdminUser {
  id: string;
  phone: string;
  displayName: string | null;
  role: 'user' | 'admin';
  status: 'active' | 'banned';
  createdAt: string;
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[] | null>(null);

  function load() {
    const token = getAccessToken();
    if (!token) return;
    apiFetch<{ items: AdminUser[] }>('/admin/users?per_page=100', { token }).then((res) => setUsers(res.items));
  }

  useEffect(load, []);

  async function toggleRole(u: AdminUser) {
    const token = getAccessToken();
    if (!token) return;
    await apiFetch(`/admin/users/${u.id}`, {
      method: 'PATCH',
      token,
      body: { role: u.role === 'admin' ? 'user' : 'admin' },
    });
    load();
  }

  async function toggleStatus(u: AdminUser) {
    const token = getAccessToken();
    if (!token) return;
    if (u.status === 'active' && !confirm(`Ban ${u.phone}? They won't be able to log in.`)) return;
    await apiFetch(`/admin/users/${u.id}`, {
      method: 'PATCH',
      token,
      body: { status: u.status === 'active' ? 'banned' : 'active' },
    });
    load();
  }

  if (!users) return <p>Loading…</p>;

  return (
    <div>
      <h1 style={{ fontSize: 22, marginBottom: 24 }}>Users</h1>
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={thStyle}>Phone</th>
            <th style={thStyle}>Joined</th>
            <th style={thStyle}>Role</th>
            <th style={thStyle}>Status</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td style={tdStyle}>{u.phone}</td>
              <td style={tdStyle}>{new Date(u.createdAt).toLocaleDateString()}</td>
              <td style={tdStyle}>
                <button className="btn" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => toggleRole(u)}>
                  {u.role}
                </button>
              </td>
              <td style={tdStyle}>
                <button
                  onClick={() => toggleStatus(u)}
                  style={{
                    padding: '4px 10px',
                    fontSize: 12,
                    borderRadius: 4,
                    border: 'none',
                    cursor: 'pointer',
                    background: u.status === 'active' ? '#1c3d1c' : '#3d1c1c',
                    color: u.status === 'active' ? '#7cd47c' : '#ff6b6b',
                  }}
                >
                  {u.status}
                </button>
              </td>
            </tr>
          ))}
          {users.length === 0 && (
            <tr>
              <td style={tdStyle} colSpan={4}>
                No users yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
