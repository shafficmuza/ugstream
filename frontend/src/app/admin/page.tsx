'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { getAccessToken } from '@/lib/auth';

interface Stats {
  userCount: number;
  activeSubscriptions: number;
  titleCount: number;
  publishedTitleCount: number;
  totalRevenueUgx: number;
  recentSignups7d: number;
}

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) return;
    apiFetch<Stats>('/admin/stats', { token }).then(setStats).catch(() => {});
  }, []);

  if (!stats) return <p>Loading…</p>;

  const cards = [
    { label: 'Users', value: stats.userCount },
    { label: 'New users (7d)', value: stats.recentSignups7d },
    { label: 'Active subscriptions', value: stats.activeSubscriptions },
    { label: 'Titles (published / total)', value: `${stats.publishedTitleCount} / ${stats.titleCount}` },
    { label: 'Total revenue', value: `UGX ${stats.totalRevenueUgx.toLocaleString()}` },
  ];

  return (
    <div>
      <h1 style={{ fontSize: 22, marginBottom: 24 }}>Dashboard</h1>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 16 }}>
        {cards.map((c) => (
          <div key={c.label} style={{ border: '1px solid #333', borderRadius: 6, padding: 16 }}>
            <div style={{ fontSize: 13, opacity: 0.7, marginBottom: 6 }}>{c.label}</div>
            <div style={{ fontSize: 24, fontWeight: 700 }}>{c.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
