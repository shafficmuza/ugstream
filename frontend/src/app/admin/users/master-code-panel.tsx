'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { getAccessToken } from '@/lib/auth';

interface MasterCodeStatus {
  active: boolean;
  expiresAt: string | null;
  issuedAt: string | null;
  uses: number;
  failures: number;
  failuresRemaining: number;
  inactiveReason: 'none-issued' | 'expired' | 'revoked' | 'locked-out' | null;
}

const HOURS_OPTIONS = [
  { label: '6 hours', value: 6 },
  { label: '24 hours', value: 24 },
  { label: '3 days', value: 72 },
  { label: '7 days', value: 168 },
];

const INACTIVE_COPY: Record<NonNullable<MasterCodeStatus['inactiveReason']>, string> = {
  'none-issued': 'No master code has been issued.',
  expired: 'The last master code expired.',
  revoked: 'The last master code was revoked.',
  'locked-out':
    'The last master code was disabled after too many wrong guesses. That can mean someone was trying to guess it — issue a new one only if you still need it.',
};

/**
 * Issue, watch and kill the break-glass master sign-in code.
 *
 * Deliberately noisy. A code that opens any account is worth exactly as much
 * as every account it can open, so this panel keeps its remaining life, its
 * use count and its failed-guess count on screen the whole time it is live,
 * and puts revoking one click away.
 */
export function MasterCodePanel() {
  const [status, setStatus] = useState<MasterCodeStatus | null>(null);
  const [issued, setIssued] = useState<string | null>(null);
  const [hours, setHours] = useState(24);
  const [busy, setBusy] = useState(false);

  function load() {
    const token = getAccessToken();
    if (!token) return;
    apiFetch<MasterCodeStatus>('/admin/master-code', { token })
      .then(setStatus)
      .catch(() => setStatus(null));
  }

  useEffect(load, []);

  async function issue() {
    const token = getAccessToken();
    if (!token) return;
    if (
      !confirm(
        `Issue a master sign-in code valid for ${hours} hours?\n\n` +
          `It will sign in to ANY subscriber account, without an SMS. Anyone who ` +
          `learns it can open any account until it expires or you revoke it.\n\n` +
          `Only issue this during an SMS outage, and revoke it as soon as SMS is working.`,
      )
    )
      return;

    setBusy(true);
    try {
      const res = await apiFetch<{ code: string }>('/admin/master-code', {
        method: 'POST',
        token,
        body: { hours },
      });
      setIssued(res.code);
      load();
    } catch (e: any) {
      alert(e.message ?? 'Could not issue a master code.');
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    const token = getAccessToken();
    if (!token) return;
    if (!confirm('Revoke the master sign-in code now? It will stop working immediately.')) return;
    setBusy(true);
    try {
      await apiFetch('/admin/master-code', { method: 'DELETE', token });
      setIssued(null);
      load();
    } finally {
      setBusy(false);
    }
  }

  if (!status) return null;

  return (
    <div
      style={{
        border: '1px solid #3a3a3a',
        borderLeft: `3px solid ${status.active ? '#e50914' : '#555'}`,
        borderRadius: 6,
        padding: '16px 18px',
        marginBottom: 24,
        background: '#181818',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <b style={{ fontSize: 14 }}>Master sign-in code</b>
        <span
          style={{
            fontSize: 11,
            padding: '2px 8px',
            borderRadius: 10,
            background: status.active ? '#e50914' : '#333',
            color: '#fff',
          }}
        >
          {status.active ? 'LIVE' : 'off'}
        </span>
      </div>

      {issued && (
        <>
          <div style={{ fontSize: 34, letterSpacing: 6, fontWeight: 700, fontFamily: 'monospace' }}>
            {issued}
          </div>
          <p style={{ fontSize: 12.5, opacity: 0.6, marginTop: 8, marginBottom: 12, lineHeight: 1.5 }}>
            Write this down now — it is never shown again. Users enter it on the normal sign-in
            screen in place of the SMS code.
          </p>
        </>
      )}

      {status.active ? (
        <p style={{ fontSize: 12.5, opacity: 0.75, lineHeight: 1.6, margin: '0 0 12px' }}>
          Expires <b>{new Date(status.expiresAt!).toLocaleString()}</b>. Used on{' '}
          <b>{status.uses}</b> {status.uses === 1 ? 'account' : 'accounts'} so far.{' '}
          {status.failures > 0 && (
            <>
              <b>{status.failures}</b> wrong{' '}
              {status.failures === 1 ? 'guess' : 'guesses'} — it disables itself after{' '}
              {status.failures + status.failuresRemaining}.{' '}
            </>
          )}
          It does not work on admin or editor accounts; those still need a per-user code.
        </p>
      ) : (
        <p style={{ fontSize: 12.5, opacity: 0.65, lineHeight: 1.6, margin: '0 0 12px' }}>
          {INACTIVE_COPY[status.inactiveReason ?? 'none-issued']} Issue one only while SMS delivery
          is failing — it opens any subscriber account without a message being sent.
        </p>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {!status.active && (
          <>
            <select
              value={hours}
              onChange={(e) => setHours(Number(e.target.value))}
              style={{
                background: '#111',
                color: '#eee',
                border: '1px solid #3a3a3a',
                borderRadius: 4,
                padding: '5px 8px',
                fontSize: 12,
              }}
            >
              {HOURS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <button
              className="btn"
              disabled={busy}
              style={{ fontSize: 12, padding: '5px 14px' }}
              onClick={issue}
            >
              {busy ? 'Working…' : 'Issue master code'}
            </button>
          </>
        )}
        {status.active && (
          <button
            className="btn"
            disabled={busy}
            style={{ fontSize: 12, padding: '5px 14px' }}
            onClick={revoke}
          >
            {busy ? 'Working…' : 'Revoke now'}
          </button>
        )}
      </div>
    </div>
  );
}
