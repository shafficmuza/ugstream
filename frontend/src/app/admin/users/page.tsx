'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { getAccessToken } from '@/lib/auth';
import { tableStyle, thStyle, tdStyle } from '../shared';
import { MasterCodePanel } from './master-code-panel';

interface AdminUser {
  id: string;
  phone: string;
  displayName: string | null;
  email: string | null;
  address: string | null;
  role: 'user' | 'editor' | 'admin';
  status: 'active' | 'banned';
  isTester: boolean;
  canPreviewAll: boolean;
  createdAt: string;
  pinSet: boolean;
  pinLockedUntil: string | null;
  sessionCount: number;
  watchCount: number;
  subscription: { planName: string | null; expiresAt: string } | null;
}

const ROLES: AdminUser['role'][] = ['user', 'editor', 'admin'];

/** One labelled field in the expanded detail panel. */
function Detail({ label, value, empty = '—' }: { label: string; value?: string | null; empty?: string }) {
  return (
    <div>
      <div style={{ opacity: 0.5, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {label}
      </div>
      <div style={{ marginTop: 3, color: value ? '#eee' : '#777' }}>{value || empty}</div>
    </div>
  );
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [issuing, setIssuing] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  // Filtered here rather than by round trip: the page already holds the list,
  // so it narrows on each keystroke without hitting the API. The backend `q`
  // still matches phone/name/email for when the account count outgrows one page.
  const visible = useMemo(() => {
    if (!users) return null;
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) =>
      [u.phone, u.displayName, u.email, u.role, u.status, u.isTester ? 'tester test' : ''].some((f) =>
        f?.toLowerCase().includes(q),
      ),
    );
  }, [users, query]);
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
   * against whoever issued it.
   *
   * This is the right tool for one stranded user, and the only one that works
   * for an admin or editor. The master code below is for an outage affecting
   * many at once, where issuing these one at a time is not fast enough.
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

  /** Put an account on the test catalogue, or back on the live one. A tester
   *  sees ONLY test titles — this is not additive, it swaps which catalogue
   *  the account is served. */
  async function toggleTester(u: AdminUser) {
    const token = getAccessToken();
    if (!token) return;
    const who = u.displayName ? `${u.displayName} (${u.phone})` : u.phone;
    if (
      !u.isTester &&
      !confirm(
        `Make ${who} a test account?\n\nThey will see ONLY titles marked for test — the live catalogue disappears for them until you switch it back.`,
      )
    )
      return;
    await apiFetch(`/admin/users/${u.id}`, {
      method: 'PATCH',
      token,
      body: { isTester: !u.isTester },
    });
    load();
  }

  /** Early access: let this account see every title while the catalogue is
   *  held back. Independent of Tester — that swaps which catalogue an account
   *  is served, this one lifts the restriction entirely. */
  async function togglePreview(u: AdminUser) {
    const token = getAccessToken();
    if (!token) return;
    const who = u.displayName ? `${u.displayName} (${u.phone})` : u.phone;
    if (
      !u.canPreviewAll &&
      !confirm(
        `Give ${who} early access?\n\nThey will see every title, including ones that are not published — while everyone else sees only the published catalogue.`,
      )
    )
      return;
    await apiFetch(`/admin/users/${u.id}`, {
      method: 'PATCH',
      token,
      body: { canPreviewAll: !u.canPreviewAll },
    });
    load();
  }

  async function toggleStatus(u: AdminUser) {
    const token = getAccessToken();
    if (!token) return;
    const who = u.displayName ? `${u.displayName} (${u.phone})` : u.phone;
    if (
      u.status === 'active' &&
      !confirm(
        `Lock ${who}?\n\nThey are signed out immediately on their next request and cannot sign in again until you unlock them. Their account, subscription and history are kept.`,
      )
    )
      return;
    await apiFetch(`/admin/users/${u.id}`, {
      method: 'PATCH',
      token,
      body: { status: u.status === 'active' ? 'banned' : 'active' },
    });
    load();
  }

  if (!users || !visible) return <p>Loading…</p>;

  return (
    <div>
      <h1 style={{ fontSize: 22, marginBottom: 24 }}>
        Users
        <span style={{ opacity: 0.5, fontSize: 14, fontWeight: 400, marginLeft: 8 }}>
          {query.trim() ? `${visible.length} of ${users.length}` : users.length}
        </span>
      </h1>

      <MasterCodePanel />

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
      <div style={{ marginBottom: 16 }}>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, phone, email, role or status…"
          aria-label="Search users"
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
            <th style={thStyle}>Phone</th>
            <th style={thStyle}>Joined</th>
            <th style={thStyle}>Role</th>
            <th style={thStyle}>Access</th>
            <th style={thStyle}>Sign-in help</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((u) => (
            <Fragment key={u.id}>
            <tr>
              <td style={tdStyle}>
                <button
                  onClick={() => setExpanded(expanded === u.id ? null : u.id)}
                  title="Show details"
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    color: u.displayName ? '#fff' : '#888',
                    cursor: 'pointer',
                    font: 'inherit',
                    textAlign: 'left',
                  }}
                >
                  <span style={{ opacity: 0.5, marginRight: 6 }}>{expanded === u.id ? '▾' : '▸'}</span>
                  {u.displayName ?? 'No name'}
                </button>
              </td>
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
                  title={
                    u.status === 'active'
                      ? 'Lock this account — signs them out and blocks sign-in'
                      : 'Unlock this account — lets them sign in again'
                  }
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
                  {u.status === 'active' ? '🔓 Unlocked' : '🔒 Locked'}
                </button>
                <button
                  onClick={() => toggleTester(u)}
                  title={u.isTester ? 'On the test catalogue. Click to return to live.' : 'Put this account on the test catalogue only.'}
                  style={{
                    marginLeft: 8,
                    padding: '4px 10px',
                    fontSize: 12,
                    borderRadius: 4,
                    border: '1px solid #333',
                    cursor: 'pointer',
                    background: u.isTester ? '#2a2a3d' : 'transparent',
                    color: u.isTester ? '#8ec3e6' : '#777',
                  }}
                >
                  {u.isTester ? 'Tester' : 'Live'}
                </button>
                <button
                  onClick={() => togglePreview(u)}
                  title={u.canPreviewAll ? 'Sees every title, published or not. Click to remove.' : 'Give early access to unpublished titles.'}
                  style={{
                    marginLeft: 8,
                    padding: '4px 10px',
                    fontSize: 12,
                    borderRadius: 4,
                    border: '1px solid #333',
                    cursor: 'pointer',
                    background: u.canPreviewAll ? '#3d3320' : 'transparent',
                    color: u.canPreviewAll ? '#e6c88e' : '#777',
                  }}
                >
                  {u.canPreviewAll ? 'Early access' : '—'}
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
            {expanded === u.id && (
              <tr>
                <td style={{ ...tdStyle, background: '#141414' }} colSpan={6}>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
                      gap: 14,
                      padding: '6px 2px',
                      fontSize: 13,
                    }}
                  >
                    <Detail label="Name" value={u.displayName} />
                    <Detail label="Phone" value={u.phone} />
                    <Detail label="Email" value={u.email} />
                    <Detail label="Address" value={u.address} />
                    <Detail
                      label="Subscription"
                      value={
                        u.subscription
                          ? `${u.subscription.planName ?? 'Active'} · until ${new Date(
                              u.subscription.expiresAt,
                            ).toLocaleDateString()}`
                          : null
                      }
                      empty="No active subscription"
                    />
                    <Detail label="Sign-in PIN" value={u.pinSet ? 'Set' : null} empty="Not set" />
                    <Detail
                      label="PIN lockout"
                      value={
                        u.pinLockedUntil && new Date(u.pinLockedUntil) > new Date()
                          ? `Locked until ${new Date(u.pinLockedUntil).toLocaleTimeString()}`
                          : null
                      }
                      empty="None"
                    />
                    <Detail
                      label="Catalogue"
                      value={
                        u.canPreviewAll
                          ? 'EARLY ACCESS — sees every title'
                          : u.isTester
                            ? 'TEST — sees test titles only'
                            : 'Live'
                      }
                    />
                    <Detail label="Devices signed in" value={String(u.sessionCount)} />
                    <Detail label="Titles watched" value={String(u.watchCount)} />
                    <Detail label="Joined" value={new Date(u.createdAt).toLocaleString()} />
                  </div>
                </td>
              </tr>
            )}
            </Fragment>
          ))}
          {visible.length === 0 && (
            <tr>
              <td style={tdStyle} colSpan={6}>
                {users.length === 0 ? 'No users yet.' : `No users match “${query.trim()}”.`}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      </div>
    </div>
  );
}
