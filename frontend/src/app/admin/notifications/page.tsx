'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { getAccessToken } from '@/lib/auth';
import { tableStyle, thStyle, tdStyle, labelStyle, inputStyle } from '../shared';

interface Stats {
  total: number;
  android: number;
  ios: number;
  signedIn: number;
  configured: boolean;
}

interface Sent {
  id: string;
  title: string;
  body: string;
  audience: string;
  sentCount: number;
  failedCount: number;
  createdAt: string;
  titleRef: { name: string; slug: string } | null;
}

export default function AdminNotificationsPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [history, setHistory] = useState<Sent[]>([]);
  const [serviceAccount, setServiceAccount] = useState('');
  const [bTitle, setBTitle] = useState('');
  const [bBody, setBBody] = useState('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const token = getAccessToken();
    if (!token) return;
    const [s, h] = await Promise.all([
      apiFetch<Stats>('/admin/notifications/stats', { token }),
      apiFetch<Sent[]>('/admin/notifications', { token }),
    ]);
    setStats(s);
    setHistory(h);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function saveCredential() {
    setBusy(true);
    setMsg(null);
    try {
      await apiFetch('/admin/notifications/credentials', {
        token: getAccessToken()!,
        method: 'POST',
        body: { serviceAccount },
      });
      setServiceAccount('');
      setMsg({ kind: 'ok', text: 'Firebase credentials saved. Push is now active.' });
      await load();
    } catch (e) {
      setMsg({ kind: 'err', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function broadcast() {
    if (!confirm(`Send "${bTitle}" to every device? This cannot be undone.`)) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await apiFetch<{ sent?: number; failed?: number; skipped?: string }>(
        '/admin/notifications/broadcast',
        { token: getAccessToken()!, method: 'POST', body: { title: bTitle, body: bBody } },
      );
      setMsg(
        res.skipped
          ? { kind: 'err', text: `Not sent: ${res.skipped}` }
          : { kind: 'ok', text: `Sent to ${res.sent} devices (${res.failed} failed).` },
      );
      setBTitle('');
      setBBody('');
      await load();
    } catch (e) {
      setMsg({ kind: 'err', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1 style={{ fontSize: 22, marginBottom: 8 }}>Notifications</h1>
      <p style={{ opacity: 0.7, fontSize: 14, marginBottom: 24 }}>
        Viewers are alerted on their phones whenever a title is published for the first time.
        Re-publishing a title does not send a second alert — use Resend on the title if you
        genuinely want to announce it again.
      </p>

      {msg && (
        <p
          style={{
            padding: '10px 12px',
            borderRadius: 4,
            marginBottom: 20,
            background: msg.kind === 'ok' ? '#14361d' : '#3a1a1a',
            color: msg.kind === 'ok' ? '#7cd47c' : '#ff8f8f',
          }}
        >
          {msg.text}
        </p>
      )}

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 16, marginBottom: 12 }}>Status</h2>
        {!stats ? (
          <p>Loading…</p>
        ) : (
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            <Stat label="Firebase" value={stats.configured ? 'Connected' : 'Not set up'} warn={!stats.configured} />
            <Stat label="Devices" value={String(stats.total)} />
            <Stat label="Android" value={String(stats.android)} />
            <Stat label="iPhone" value={String(stats.ios)} />
          </div>
        )}
      </section>

      <section style={{ marginBottom: 32, maxWidth: 640 }}>
        <h2 style={{ fontSize: 16, marginBottom: 12 }}>Firebase credentials</h2>
        <p style={{ opacity: 0.7, fontSize: 13, marginBottom: 12 }}>
          Firebase Console → Project settings → Service accounts → Generate new private key.
          Paste the whole downloaded file here. It is stored securely and never shown again.
        </p>
        <label style={labelStyle}>Service account JSON</label>
        <textarea
          value={serviceAccount}
          onChange={(e) => setServiceAccount(e.target.value)}
          rows={6}
          placeholder='{ "type": "service_account", "project_id": "…" }'
          style={{ ...inputStyle, fontFamily: 'monospace', fontSize: 12 }}
        />
        <button onClick={saveCredential} disabled={busy || !serviceAccount.trim()} style={btn}>
          Save credentials
        </button>
      </section>

      <section style={{ marginBottom: 32, maxWidth: 640 }}>
        <h2 style={{ fontSize: 16, marginBottom: 12 }}>Send an announcement</h2>
        <p style={{ opacity: 0.7, fontSize: 13, marginBottom: 12 }}>
          Goes to every device immediately. Use sparingly — too many alerts and people turn
          them off for good.
        </p>
        <label style={labelStyle}>Title</label>
        <input value={bTitle} onChange={(e) => setBTitle(e.target.value)} style={inputStyle} maxLength={120} />
        <label style={labelStyle}>Message</label>
        <input value={bBody} onChange={(e) => setBBody(e.target.value)} style={inputStyle} maxLength={400} />
        <button
          onClick={broadcast}
          disabled={busy || !stats?.configured || bTitle.trim().length < 3 || bBody.trim().length < 3}
          style={btn}
        >
          Send to everyone
        </button>
      </section>

      <section>
        <h2 style={{ fontSize: 16, marginBottom: 12 }}>Recently sent</h2>
        {history.length === 0 ? (
          <p style={{ opacity: 0.6 }}>Nothing sent yet.</p>
        ) : (
          <div className="table-wrap">
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>When</th>
                  <th style={thStyle}>Notification</th>
                  <th style={thStyle}>To</th>
                  <th style={thStyle}>Delivered</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id}>
                    <td style={tdStyle}>{new Date(h.createdAt).toLocaleString()}</td>
                    <td style={tdStyle}>{h.title}</td>
                    <td style={tdStyle}>{h.audience === 'all' ? 'Everyone' : 'Subscribers'}</td>
                    <td style={tdStyle}>
                      {h.sentCount}
                      {h.failedCount > 0 && (
                        <span style={{ color: '#ff8f8f' }}> ({h.failedCount} failed)</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, color: warn ? '#e0c14a' : 'white' }}>{value}</div>
    </div>
  );
}

const btn: React.CSSProperties = {
  padding: '10px 18px',
  borderRadius: 4,
  border: 'none',
  background: '#e50914',
  color: 'white',
  cursor: 'pointer',
};
