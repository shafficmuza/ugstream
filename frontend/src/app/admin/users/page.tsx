'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { getAccessToken } from '@/lib/auth';
import { tableStyle, thStyle, tdStyle } from '../shared';

interface AdminUser {
  id: string;
  phone: string;
  displayName: string | null;
  role: 'user' | 'editor' | 'admin';
  status: 'active' | 'banned';
  createdAt: string;
}

const ROLES: AdminUser['role'][] = ['user', 'editor', 'admin'];

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [issuing, setIssuing] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<{ phone: string; code: string; minutes: number } | null>(
    null,
  );

  function load() {
    const token = getAccessToken();
    if (!token) return;
    apiFetch<{ items: AdminUser[] }>('/admin/users?per_page=100', { token }).then((res) => setUsers(res.items));
  }

  useEffect(load, []);

  async function setRole(u: AdminUser, role: AdminUser['role']) {
    if (role === u.role) return;
    const token = getAccessToken();
    if (!token) return;
    if (role === 'admin' && !confirm(`Make ${u.phone} an ADMIN? They'll have full access, including deletes and payments.`)) return;
    await apiFetch(`/admin/users/${u.id}`, { method: 'PATCH', token, body: { role } });
    load();
  }

  /**
   * A sign-in code for someone who cannot receive SMS. Scoped to this one
   * account, single use, expires in minutes, and recorded in the activity log
   * against whoever issued it — which is what makes it safe to hand out, and
   * why there is no single master code to leak.
   */
  async function issueRecoveryCode(u: AdminUser) {
    const token = getAccessToken();
    if (!token) return;
    if (
      !confirm(
        `Issue a one-time sign-in code for ${u.phone}?\n\n` +
          `It signs in to this account only, works once, and expires in 15 minutes. ` +
          `Give it only to someone you have confirmed owns this number — it is the ` +
          `same as handing them the account.`,
      )
    )
      return;
    setIssuing(u.id);
    try {
      const res = await apiFetch<{ code: string; expiresInMinutes: number }>(
        `/admin/users/${u.id}/recovery-code`,
        { method: 'POST', token },
      );
      setRecovery({ phone: u.phone, code: res.code, minutes: res.expiresInMinutes });
    } catch (e: any) {
      alert(e.message ?? 'Could not issue a code.');
    } finally {
      setIssuing(null);
    }
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

      {recovery && (
        <div
          style={{
            border: '1px solid #3a3a3a',
            borderLeft: '3px solid #e50914',
            borderRadius: 6,
            padding: '16px 18px',
            marginBottom: 24,
            background: '#181818',
          }}
        >
          <div style={{ fontSize: 13, opacity: 0.75, marginBottom: 8 }}>
            One-time sign-in code for <b>{recovery.phone}</b>
          </div>
          <div style={{ fontSize: 34, letterSpacing: 6, fontWeight: 700, fontFamily: 'monospace' }}>
            {recovery.code}
          </div>
          <p style={{ fontSize: 12.5, opacity: 0.6, marginTop: 10, marginBottom: 12, lineHeight: 1.5 }}>
            Read this to the user; they enter it on the normal sign-in screen after requesting a
            code. It works once, expires in {recovery.minutes} minutes, and opens only this
            account. It is not shown again — issue a new one if it is lost.
          </p>
          <button
            className="btn"
            style={{ fontSize: 12, padding: '5px 14px' }}
            onClick={() => setRecovery(null)}
          >
            Done
          </button>
        </div>
      )}
      <div className="table-wrap">
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={thStyle}>Phone</th>
            <th style={thStyle}>Joined</th>
            <th style={thStyle}>Role</th>
            <th style={thStyle}>Status</th>
            <th style={thStyle}>Locked out?</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td style={tdStyle}>{u.phone}</td>
              <td style={tdStyle}>{new Date(u.createdAt).toLocaleDateString()}</td>
              <td style={tdStyle}>
                <select
                  value={u.role}
                  onChange={(e) => setRole(u, e.target.value as AdminUser['role'])}
                  style={{ padding: '4px 8px', fontSize: 12, background: '#1a1a1a', color: '#fff', border: '1px solid #333', borderRadius: 4 }}
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
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
              <td style={tdStyle}>
                <button
                  onClick={() => issueRecoveryCode(u)}
                  disabled={issuing === u.id}
                  style={{
                    padding: '4px 10px',
                    fontSize: 12,
                    borderRadius: 4,
                    border: '1px solid #3a3a3a',
                    cursor: 'pointer',
                    background: 'transparent',
                    color: '#b3b3b3',
                  }}
                >
                  {issuing === u.id ? 'Issuing…' : 'Sign-in code'}
                </button>
              </td>
            </tr>
          ))}
          {users.length === 0 && (
            <tr>
              <td style={tdStyle} colSpan={5}>
                No users yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      </div>
    </div>
  );
}
