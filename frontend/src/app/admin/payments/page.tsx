'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { getAccessToken } from '@/lib/auth';
import { tableStyle, thStyle, tdStyle } from '../shared';

interface Payment {
  id: string;
  userPhone: string;
  amountUgx: number;
  purpose: string;
  planName: string | null;
  status: string;
  provider: string;
  createdAt: string;
}

const statusColor: Record<string, string> = {
  successful: '#7cd47c',
  pending: '#e0c14a',
  failed: '#ff6b6b',
  refunded: '#999',
};

export default function AdminPaymentsPage() {
  const [payments, setPayments] = useState<Payment[] | null>(null);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) return;
    apiFetch<{ items: Payment[] }>('/admin/payments?per_page=50', { token }).then((res) => setPayments(res.items));
  }, []);

  if (!payments) return <p>Loading…</p>;

  return (
    <div>
      <h1 style={{ fontSize: 22, marginBottom: 24 }}>Payments</h1>
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={thStyle}>Date</th>
            <th style={thStyle}>Phone</th>
            <th style={thStyle}>Purpose</th>
            <th style={thStyle}>Amount</th>
            <th style={thStyle}>Status</th>
          </tr>
        </thead>
        <tbody>
          {payments.map((p) => (
            <tr key={p.id}>
              <td style={tdStyle}>{new Date(p.createdAt).toLocaleString()}</td>
              <td style={tdStyle}>{p.userPhone}</td>
              <td style={tdStyle}>{p.purpose === 'subscription' ? p.planName ?? 'Subscription' : 'Title purchase'}</td>
              <td style={tdStyle}>UGX {p.amountUgx.toLocaleString()}</td>
              <td style={{ ...tdStyle, color: statusColor[p.status] ?? 'inherit' }}>{p.status}</td>
            </tr>
          ))}
          {payments.length === 0 && (
            <tr>
              <td style={tdStyle} colSpan={5}>
                No payments yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
