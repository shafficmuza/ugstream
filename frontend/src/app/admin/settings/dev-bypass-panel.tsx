'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { getAccessToken } from '@/lib/auth';

interface DevBypassStatus {
  enabled: boolean;
  codeSet: boolean;
  phones: string[];
  failures: number;
  failuresRemaining: number;
  setAt: string | null;
  autoDisabled: boolean;
}

/**
 * The development sign-in code.
 *
 * Kept visually loud when it is on, because the failure mode is forgetting it
 * is on: a fixed code on a live site is a standing account-takeover risk, and
 * nothing about normal use of the admin panel would otherwise remind anyone.
 */
export function DevBypassPanel() {
  const [status, setStatus] = useState<DevBypassStatus | null>(null);
  const [code, setCode] = useState('');
  const [phones, setPhones] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  function load() {
    const token = getAccessToken();
    if (!token) return;
    apiFetch<DevBypassStatus>('/admin/dev-bypass', { token })
      .then((s) => {
        setStatus(s);
        setPhones(s.phones.join(', '));
      })
      .catch(() => setStatus(null));
  }

  useEffect(load, []);

  async function save(body: Record<string, unknown>, note: string) {
    const token = getAccessToken();
    if (!token) return;
    setBusy(true);
    setMsg(null);
    try {
      const s = await apiFetch<DevBypassStatus>('/admin/dev-bypass', {
        method: 'PATCH',
        token,
        body,
      });
      setStatus(s);
      setPhones(s.phones.join(', '));
      setCode('');
      setMsg(note);
    } catch (e: any) {
      setMsg(e.message ?? 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  function saveCodeAndNumbers() {
    const list = phones
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    const body: Record<string, unknown> = { phones: list };
    if (code.trim()) body.code = code.trim();
    save(body, code.trim() ? 'Code and numbers saved.' : 'Numbers saved.');
  }

  async function toggle() {
    if (status?.enabled) {
      save({ enabled: false }, 'Development code switched off.');
      return;
    }
    if (
      !confirm(
        `Switch the development sign-in code ON?\n\n` +
          `The listed numbers will be able to sign in with a fixed code and no SMS — ` +
          `including admin accounts. Anyone who learns the code and one of those ` +
          `numbers can sign in as them.\n\nSwitch it off when you are done building.`,
      )
    )
      return;
    save({ enabled: true }, 'Development code is live.');
  }

  if (!status) return null;

  return (
    <section style={{ marginTop: 36 }}>
      <h2 style={{ fontSize: 16, marginBottom: 6 }}>
        Development sign-in code{' '}
        <span
          style={{
            fontSize: 11,
            padding: '2px 8px',
            borderRadius: 10,
            marginLeft: 6,
            background: status.enabled ? '#e50914' : '#333',
            color: '#fff',
            verticalAlign: 'middle',
          }}
        >
          {status.enabled ? 'LIVE' : 'off'}
        </span>
      </h2>

      <p style={{ fontSize: 12.5, opacity: 0.65, lineHeight: 1.6, maxWidth: 620, marginBottom: 14 }}>
        A fixed code that stands in for the SMS code, for the numbers listed below only. Lets the
        team sign in while building without paying for or waiting on a message. Unlike the master
        code, this one <b>does</b> open admin accounts — which is why it is limited to numbers you
        name here rather than to everyone with an admin role.
        {status.autoDisabled && (
          <>
            {' '}
            <b style={{ color: '#e87c7c' }}>
              It switched itself off after too many wrong codes. If nobody was mistyping, someone
              was guessing — rotate the code before switching it back on.
            </b>
          </>
        )}
        {status.enabled && status.failures > 0 && (
          <>
            {' '}
            <b style={{ color: '#e87c7c' }}>
              {status.failures} wrong {status.failures === 1 ? 'attempt' : 'attempts'} so far; it
              switches itself off after {status.failures + status.failuresRemaining}.
            </b>
          </>
        )}
      </p>

      <div style={{ display: 'grid', gap: 12, maxWidth: 460 }}>
        <label style={{ fontSize: 12.5 }}>
          <div style={{ opacity: 0.7, marginBottom: 5 }}>
            Code {status.codeSet && <span style={{ opacity: 0.55 }}>— set; type a new one to change it</span>}
          </div>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder={status.codeSet ? '••••' : 'e.g. 1234'}
            style={inputStyle}
          />
        </label>

        <label style={{ fontSize: 12.5 }}>
          <div style={{ opacity: 0.7, marginBottom: 5 }}>
            Phone numbers that may use it (comma separated, up to 5)
          </div>
          <input
            value={phones}
            onChange={(e) => setPhones(e.target.value)}
            placeholder="+256775200442, 0772878614"
            style={inputStyle}
          />
        </label>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn" disabled={busy} onClick={saveCodeAndNumbers} style={btnStyle}>
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button className="btn" disabled={busy} onClick={toggle} style={btnStyle}>
            {status.enabled ? 'Switch off' : 'Switch on'}
          </button>
          {msg && <span style={{ fontSize: 12, opacity: 0.7 }}>{msg}</span>}
        </div>
      </div>
    </section>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: '#111',
  color: '#eee',
  border: '1px solid #3a3a3a',
  borderRadius: 4,
  padding: '8px 10px',
  fontSize: 13,
};

const btnStyle: React.CSSProperties = { fontSize: 12, padding: '6px 16px' };
