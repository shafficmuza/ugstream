'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { getAccessToken } from '@/lib/auth';

interface Plan {
  id: number;
  name: string;
  priceUgx: number;
  durationDays: number;
}

export default function SubscribePage() {
  const router = useRouter();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [redirecting, setRedirecting] = useState<string | null>(null);
  const [momoWait, setMomoWait] = useState<{ planName: string; status: 'waiting' | 'success' | 'failed' } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    apiFetch<Plan[]>('/plans').then(setPlans).catch(() => setPlans([]));
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // Flutterwave button hidden for now — not configured yet (no secret key).
  // The 'flutterwave' provider code path itself is untouched, just not
  // exposed here; re-enable once it's actually live.
  async function subscribeRedirect(planId: number, provider: 'stripe') {
    const token = getAccessToken();
    if (!token) return;
    setRedirecting(`${planId}-${provider}`);
    const res = await apiFetch<{ paymentId: string; checkoutUrl: string }>('/payments/checkout', {
      method: 'POST',
      token,
      body: { purpose: 'subscription', planId, provider },
    });
    sessionStorage.setItem('ugstream_pending_payment_id', res.paymentId);
    window.location.href = res.checkoutUrl;
  }

  // MTN MoMo has no hosted checkout page — it pushes an approval prompt
  // straight to the customer's phone, so instead of redirecting we poll
  // our own payment-status endpoint right here until they approve (or it
  // fails/times out).
  async function subscribeMomo(plan: Plan) {
    const token = getAccessToken();
    if (!token) return;
    setMomoWait({ planName: plan.name, status: 'waiting' });

    let paymentId: string;
    try {
      const res = await apiFetch<{ paymentId: string }>('/payments/checkout', {
        method: 'POST',
        token,
        body: { purpose: 'subscription', planId: plan.id, provider: 'momo' },
      });
      paymentId = res.paymentId;
    } catch (e: any) {
      setMomoWait({ planName: plan.name, status: 'failed' });
      return;
    }

    let attempts = 0;
    pollRef.current = setInterval(async () => {
      attempts += 1;
      try {
        const status = await apiFetch<{ status: string }>(`/payments/${paymentId}`, { token });
        if (status.status === 'successful') {
          clearInterval(pollRef.current!);
          setMomoWait({ planName: plan.name, status: 'success' });
          setTimeout(() => router.push('/'), 1500);
        } else if (status.status === 'failed' || attempts > 60) {
          clearInterval(pollRef.current!);
          setMomoWait({ planName: plan.name, status: 'failed' });
        }
      } catch {
        if (attempts > 60) {
          clearInterval(pollRef.current!);
          setMomoWait({ planName: plan.name, status: 'failed' });
        }
      }
    }, 2000);
  }

  if (momoWait) {
    return (
      <main style={{ maxWidth: 480, margin: '80px auto', padding: '0 20px', textAlign: 'center' }}>
        {momoWait.status === 'waiting' && (
          <>
            <h1 style={{ fontSize: 20 }}>Check your phone</h1>
            <p style={{ opacity: 0.8 }}>
              Approve the {momoWait.planName} payment on your phone — enter your MTN Mobile Money PIN when
              prompted.
            </p>
          </>
        )}
        {momoWait.status === 'success' && <p>Payment confirmed! Redirecting…</p>}
        {momoWait.status === 'failed' && (
          <>
            <p>Payment was not completed.</p>
            <button className="btn" style={{ marginTop: 12 }} onClick={() => setMomoWait(null)}>
              Try again
            </button>
          </>
        )}
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 480, margin: '80px auto', padding: '0 20px' }}>
      <h1 style={{ fontSize: 22 }}>Choose a plan</h1>
      <p style={{ opacity: 0.7, fontSize: 14 }}>Pay by MTN Mobile Money or card.</p>

      {plans.map((p) => (
        <div
          key={p.id}
          style={{
            border: '1px solid #333',
            borderRadius: 6,
            padding: '14px 16px',
            marginTop: 12,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontWeight: 600 }}>{p.name}</div>
              <div style={{ opacity: 0.7, fontSize: 13 }}>{p.durationDays} days</div>
            </div>
            <div style={{ fontWeight: 700 }}>UGX {p.priceUgx.toLocaleString()}</div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button className="btn" style={{ flex: 1 }} disabled={!!redirecting} onClick={() => subscribeMomo(p)}>
              MTN MoMo
            </button>
            <button
              className="btn"
              style={{ flex: 1, background: '#2c3e50' }}
              disabled={!!redirecting}
              onClick={() => subscribeRedirect(p.id, 'stripe')}
            >
              {redirecting === `${p.id}-stripe` ? 'Redirecting…' : 'Pay by Card'}
            </button>
          </div>
        </div>
      ))}
    </main>
  );
}
