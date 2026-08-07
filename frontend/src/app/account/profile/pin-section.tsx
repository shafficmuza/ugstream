'use client';

import { useState } from 'react';
import { apiFetch } from '@/lib/api';
import { getAccessToken } from '@/lib/auth';

/**
 * Set, change or remove the sign-in PIN.
 *
 * The PIN is what makes a returning sign-in free, so removing it is offered
 * plainly rather than hidden: a user who is uneasy about a short code guarding
 * their account should be able to go back to SMS without asking anyone.
 */
export function PinSection({ pinSet, onChanged }: { pinSet: boolean; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [currentPin, setCurrentPin] = useState('');
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function reset() {
    setCurrentPin('');
    setPin('');
    setConfirm('');
    setError(null);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (pin !== confirm) {
      setError('The two PINs do not match.');
      return;
    }
    const token = getAccessToken();
    if (!token) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await apiFetch('/auth/pin', {
        method: 'POST',
        token,
        body: pinSet ? { pin, currentPin } : { pin },
      });
      reset();
      setOpen(false);
      setMessage(pinSet ? 'PIN changed.' : 'PIN set — your next sign-in will not need a text.');
      onChanged();
    } catch (e: any) {
      setError(e.message ?? 'Could not save your PIN.');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    const token = getAccessToken();
    if (!token) return;
    if (!confirmDialog()) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await apiFetch('/auth/pin', { method: 'DELETE', token });
      setMessage('PIN removed. You will get a code by SMS when you sign in.');
      onChanged();
    } catch (e: any) {
      setError(e.message ?? 'Could not remove your PIN.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={{ marginTop: 40, borderTop: '1px solid #2a2a2a', paddingTop: 24 }}>
      <h2 style={{ fontSize: 16, marginBottom: 6 }}>Sign-in PIN</h2>
      <p style={{ opacity: 0.7, fontSize: 13.5, lineHeight: 1.55, marginBottom: 14 }}>
        {pinSet
          ? 'You sign in with your PIN. You can still get a code by SMS at any time if you forget it.'
          : 'Set a PIN to sign in without waiting for a text message.'}
      </p>

      {!open && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => setOpen(true)} disabled={busy} style={btn}>
            {pinSet ? 'Change PIN' : 'Set a PIN'}
          </button>
          {pinSet && (
            <button className="btn" onClick={remove} disabled={busy} style={btn}>
              Remove PIN
            </button>
          )}
        </div>
      )}

      {open && (
        <form onSubmit={save}>
          {pinSet && (
            <input
              style={input}
              type="password"
              inputMode="numeric"
              maxLength={8}
              value={currentPin}
              onChange={(e) => setCurrentPin(e.target.value)}
              placeholder="Current PIN"
              autoFocus
            />
          )}
          <input
            style={input}
            type="password"
            inputMode="numeric"
            maxLength={8}
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="New PIN (4–8 digits)"
            autoFocus={!pinSet}
          />
          <input
            style={input}
            type="password"
            inputMode="numeric"
            maxLength={8}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Confirm new PIN"
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" type="submit" disabled={busy || pin.length < 4} style={btn}>
              {busy ? 'Saving…' : 'Save PIN'}
            </button>
            <button
              className="btn"
              type="button"
              onClick={() => {
                reset();
                setOpen(false);
              }}
              disabled={busy}
              style={btn}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {error && <p style={{ color: '#ff6b6b', marginTop: 12, fontSize: 13.5 }}>{error}</p>}
      {message && <p style={{ color: '#3ddc84', marginTop: 12, fontSize: 13.5 }}>{message}</p>}
    </section>
  );
}

function confirmDialog() {
  return confirm(
    'Remove your PIN?\n\nYou will go back to receiving a code by SMS each time you sign in.',
  );
}

const input: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: 6,
  border: '1px solid #333',
  background: '#1a1a1a',
  color: '#fff',
  fontSize: 15,
  marginBottom: 10,
};

const btn: React.CSSProperties = { fontSize: 13, padding: '8px 18px' };
