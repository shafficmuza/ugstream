'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { getAccessToken } from '@/lib/auth';

interface Entry {
  id: string;
  action: string;
  summary: string;
  createdAt: string;
  day: string;
  user: { name: string; phone: string; role: string };
  title: { id: string; name: string } | null;
}

const border = '#2a2a2a';

export default function AdminActivityPage() {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [days, setDays] = useState(14);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) return;
    apiFetch<Entry[]>(`/admin/activity?days=${days}`, { token }).then(setEntries).catch(() => setEntries([]));
  }, [days]);

  if (!entries) return <p>Loading…</p>;

  // Group by day (entries already sorted newest-first).
  const byDay: Record<string, Entry[]> = {};
  for (const e of entries) (byDay[e.day] ||= []).push(e);
  const daysList = Object.keys(byDay).sort().reverse();

  const fmtDay = (d: string) =>
    new Date(d + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
  const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <h1 style={{ fontSize: 22 }}>Activity</h1>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          style={{ padding: '6px 10px', fontSize: 13, background: '#1a1a1a', color: '#fff', border: `1px solid ${border}`, borderRadius: 4 }}
        >
          <option value={1}>Today</option>
          <option value={7}>Last 7 days</option>
          <option value={14}>Last 14 days</option>
          <option value={30}>Last 30 days</option>
        </select>
      </div>
      <p style={{ opacity: 0.6, fontSize: 13, marginBottom: 24 }}>
        Who uploaded or created what, day by day.
      </p>

      {daysList.length === 0 && <p style={{ opacity: 0.6 }}>No activity in this period.</p>}

      {daysList.map((day) => (
        <section key={day} style={{ marginBottom: 28 }}>
          <h2 style={{ fontSize: 14, opacity: 0.8, borderBottom: `1px solid ${border}`, paddingBottom: 6, marginBottom: 10 }}>
            {fmtDay(day)} <span style={{ opacity: 0.5, fontWeight: 400 }}>· {byDay[day].length} item(s)</span>
          </h2>
          {byDay[day].map((e) => (
            <div key={e.id} style={{ display: 'flex', gap: 12, alignItems: 'baseline', padding: '6px 0', fontSize: 13.5 }}>
              <span style={{ opacity: 0.5, width: 52, flexShrink: 0 }}>{fmtTime(e.createdAt)}</span>
              <span style={{ flex: 1 }}>
                <b>{e.user.name}</b>
                <span style={{ opacity: 0.5, fontSize: 11, marginLeft: 6 }}>{e.user.role}</span>
                {' — '}
                {e.summary}
                {e.title && (
                  <>
                    {' '}
                    <Link href={`/admin/titles/${e.title.id}/edit`} style={{ color: '#e50914' }}>
                      {e.title.name}
                    </Link>
                  </>
                )}
              </span>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
