'use client';

import { useLive, humanDuration } from '@/lib/live';
import { tableStyle, thStyle, tdStyle } from '@/app/admin/shared';

/** A number that is only interesting because of how fresh it is. */
function LiveTile({ label, value, hint, accent }: { label: string; value: string | number; hint?: string; accent?: string }) {
  return (
    <div style={{ border: '1px solid #333', borderRadius: 6, padding: 16 }}>
      <div style={{ fontSize: 13, opacity: 0.7, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color: accent ?? 'inherit' }}>{value}</div>
      {hint && <div style={{ fontSize: 12, opacity: 0.55, marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

export function LiveMetrics() {
  const { live, error } = useLive(5000);

  if (!live) {
    return (
      <section style={{ marginTop: 36 }}>
        <h2 style={{ fontSize: 16, marginBottom: 12 }}>Right now</h2>
        <p style={{ opacity: 0.6, fontSize: 13 }}>Connecting…</p>
      </section>
    );
  }

  const { watching, sessions } = live;
  const updated = new Date(live.at).toLocaleTimeString();

  return (
    <section style={{ marginTop: 36 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12 }}>
        <h2 style={{ fontSize: 16 }}>Right now</h2>
        {/* A pulsing dot is the whole point: it says the number is being kept
            up to date, which a static figure cannot. */}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, opacity: 0.6 }}>
          <span
            style={{
              width: 7, height: 7, borderRadius: 999,
              background: error ? '#ffb020' : '#3ecf8e',
              animation: 'livepulse 2s ease-in-out infinite',
            }}
          />
          {error ? `Last good reading ${updated}` : `Updated ${updated}`}
        </span>
        <style>{`@keyframes livepulse{0%,100%{opacity:1}50%{opacity:.25}}`}</style>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 16 }}>
        <LiveTile
          label="Watching now"
          value={watching.count}
          hint={watching.count === watching.viewers ? undefined : `${watching.viewers} viewer${watching.viewers === 1 ? '' : 's'}`}
          accent={watching.count > 0 ? '#3ecf8e' : undefined}
        />
        <LiveTile
          label="Devices online"
          value={sessions.onlineNow}
          hint={`active in the last ${Math.round(sessions.onlineWindowSecs / 60)} min`}
        />
        <LiveTile label="Devices signed in" value={sessions.signedIn} hint="sessions never expire on a timer" />
      </div>

      <h3 style={{ fontSize: 14, margin: '28px 0 10px' }}>Active streams</h3>
      {watching.streams.length === 0 ? (
        <p style={{ opacity: 0.55, fontSize: 13 }}>Nobody is watching at the moment.</p>
      ) : (
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Viewer</th>
              <th style={thStyle}>Watching</th>
              <th style={thStyle}>Device</th>
              <th style={thStyle}>For</th>
            </tr>
          </thead>
          <tbody>
            {watching.streams.map((s, i) => (
              <tr key={`${s.userId}-${i}`}>
                <td style={tdStyle}>{s.who}</td>
                <td style={tdStyle}>
                  {s.title}
                  {s.episode && <span style={{ opacity: 0.6 }}> · {s.episode}</span>}
                </td>
                <td style={tdStyle}>{s.device ?? '—'}</td>
                <td style={tdStyle}>{humanDuration(s.watchingForSecs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3 style={{ fontSize: 14, margin: '28px 0 10px' }}>Devices online</h3>
      {sessions.devices.length === 0 ? (
        <p style={{ opacity: 0.55, fontSize: 13 }}>No devices have called in recently.</p>
      ) : (
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Who</th>
              <th style={thStyle}>Device</th>
              <th style={thStyle}>Last seen</th>
            </tr>
          </thead>
          <tbody>
            {sessions.devices.map((d) => (
              <tr key={d.sessionId}>
                <td style={tdStyle}>{d.who}</td>
                <td style={tdStyle}>{d.device ?? '—'}</td>
                <td style={tdStyle}>{d.idleSecs < 10 ? 'just now' : `${humanDuration(d.idleSecs)} ago`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
