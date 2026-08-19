'use client';

import { useLive, humanBytes } from '@/lib/live';

/**
 * Free space on the server the uploads land on.
 *
 * On the uploads page specifically, because that is where somebody is about to
 * commit several gigabytes and the moment to learn the disk is nearly full is
 * before the upload, not after it fails halfway.
 */
export function DiskUsage() {
  const { live } = useLive(15000); // slower than the dashboard: disk moves slowly
  const disk = live?.disk;

  if (!disk) {
    return (
      <div style={{ border: '1px solid #333', borderRadius: 6, padding: 16, marginBottom: 20, opacity: 0.6 }}>
        <div style={{ fontSize: 13 }}>Checking server disk…</div>
      </div>
    );
  }

  if (disk.unavailable) {
    return (
      <div style={{ border: '1px solid #333', borderRadius: 6, padding: 16, marginBottom: 20 }}>
        <div style={{ fontSize: 13, opacity: 0.7 }}>Server disk usage is unavailable.</div>
      </div>
    );
  }

  // Three bands, because the only reason to show this is to change what
  // somebody does next: green is "carry on", amber is "plan a cleanup",
  // red is "this upload may not fit".
  const pct = disk.usedPct;
  const colour = pct >= 90 ? '#ff4d4f' : pct >= 75 ? '#ffb020' : '#3ecf8e';
  const note =
    pct >= 90
      ? 'Almost full — free space before uploading anything large.'
      : pct >= 75
        ? 'Filling up. Worth a clear-out soon.'
        : 'Plenty of room.';

  return (
    <div style={{ border: '1px solid #333', borderRadius: 6, padding: 16, marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 13, opacity: 0.7 }}>Server disk</span>
        <span style={{ fontSize: 18, fontWeight: 700, color: colour }}>{pct}%</span>
        <span style={{ fontSize: 13, opacity: 0.6, marginLeft: 'auto' }}>
          {humanBytes(disk.freeBytes)} free of {humanBytes(disk.totalBytes)}
        </span>
      </div>

      <div
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Server disk usage"
        style={{ height: 10, borderRadius: 999, background: '#222', overflow: 'hidden' }}
      >
        <div
          style={{
            width: `${Math.min(100, Math.max(0, pct))}%`,
            height: '100%',
            background: colour,
            transition: 'width .4s ease, background .4s ease',
          }}
        />
      </div>

      <div style={{ fontSize: 12, opacity: 0.6, marginTop: 8 }}>
        {humanBytes(disk.usedBytes)} used · {note}
      </div>
    </div>
  );
}
