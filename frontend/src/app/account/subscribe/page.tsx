'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { getAccessToken } from '@/lib/auth';
import { useAuth } from '@/lib/auth-context';

interface Plan {
  id: number;
  name: string;
  priceUgx: number;
  durationDays: number;
}

interface CheckoutResponse {
  paymentId: string;
  provider?: string;
  checkoutUrl?: string | null;
  requiresPhoneApproval?: boolean;
  action?: { type: 'redirect' | 'phone_prompt' | 'none'; url?: string };
}

interface PayMethod {
  method: 'card' | 'mobile_money';
  provider: string;
  enabled: boolean;
  label?: string;
}

export default function SubscribePage() {
  const router = useRouter();
  const { me } = useAuth();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [redirecting, setRedirecting] = useState<string | null>(null);
  const [methods, setMethods] = useState<PayMethod[]>([]);
  const [payerPhone, setPayerPhone] = useState('');
  const [momoWait, setMomoWait] = useState<{ planName: string; status: 'waiting' | 'success' | 'failed' } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Default the mobile-money number to the account's login number, editable.
  useEffect(() => {
    if (me?.phone) setPayerPhone((prev) => prev || me.phone);
  }, [me]);

  useEffect(() => {
    apiFetch<Plan[]>('/plans').then(setPlans).catch(() => setPlans([]));
    const token = getAccessToken();
    if (token) {
      apiFetch<{ methods: PayMethod[] }>('/payments/methods', { token })
        .then((r) => setMethods(r.methods))
        .catch(() => setMethods([]));
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const cardMethod = methods.find((m) => m.method === 'card');
  const mmMethod = methods.find((m) => m.method === 'mobile_money');

  async function payByCard(planId: number) {
    const token = getAccessToken();
    if (!token) return;
    setRedirecting(`${planId}-card`);
    const res = await apiFetch<CheckoutResponse>('/payments/checkout', {
      method: 'POST',
      token,
      body: { purpose: 'subscription', planId, method: 'card' },
    });
    sessionStorage.setItem('ugstream_pending_payment_id', res.paymentId);
    window.location.href = res.checkoutUrl!;
  }

  // Mobile money routes to whichever provider the admin activated. Two shapes:
  // a redirect (DPO / Flutterwave hosted page) or a phone approval prompt
  // (MTN MoMo / Yo) that we poll for. The response's `action` tells us which.
  async function payByMobileMoney(plan: Plan) {
    const token = getAccessToken();
    if (!token) return;
    if (!/^(\+?256|0)?7\d{8}$/.test(payerPhone.replace(/\s/g, ''))) {
      alert('Enter a valid mobile money number, e.g. 0772123456.');
      return;
    }

    let res: CheckoutResponse;
    try {
      setRedirecting(`${plan.id}-mm`);
      res = await apiFetch<CheckoutResponse>('/payments/checkout', {
        method: 'POST',
        token,
        body: { purpose: 'subscription', planId: plan.id, method: 'mobile_money', payerPhone },
      });
    } catch {
      setRedirecting(null);
      setMomoWait({ planName: plan.name, status: 'failed' });
      return;
    }
    setRedirecting(null);

    // Hosted-page providers → redirect the customer to pay.
    if (res.action?.type === 'redirect' && res.checkoutUrl) {
      sessionStorage.setItem('ugstream_pending_payment_id', res.paymentId);
      window.location.href = res.checkoutUrl;
      return;
    }

    // Phone-approval providers → poll our status endpoint until they approve.
    setMomoWait({ planName: plan.name, status: 'waiting' });
    const paymentId = res.paymentId;
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
              Approve the {momoWait.planName} payment on <b>{payerPhone}</b> — enter your Mobile Money
              PIN when prompted.
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

  const mmEnabled = !mmMethod || mmMethod.enabled;

  return (
    <main style={{ maxWidth: 480, margin: '80px auto', padding: '0 20px' }}>
      <h1 style={{ fontSize: 22 }}>Choose a plan</h1>
      <p style={{ opacity: 0.7, fontSize: 14 }}>
        Pay by {mmMethod?.label ?? 'mobile money'} or card.
      </p>

      {mmEnabled && (
        <div style={{ marginTop: 16, marginBottom: 4 }}>
          <label style={{ display: 'block', fontSize: 13, opacity: 0.75, marginBottom: 6 }}>
            Mobile money number to charge
          </label>
          <input
            type="tel"
            inputMode="tel"
            value={payerPhone}
            onChange={(e) => setPayerPhone(e.target.value)}
            placeholder="e.g. 0772123456"
            style={{
              width: '100%',
              padding: '10px 12px',
              borderRadius: 6,
              border: '1px solid #333',
              background: '#1a1a1a',
              color: '#fff',
              fontSize: 15,
            }}
          />
          <p style={{ fontSize: 12, opacity: 0.55, marginTop: 4 }}>
            The approval prompt is sent to this number. Defaults to your account number — change it to
            pay from a different line.
          </p>
        </div>
      )}

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
            {(!mmMethod || mmMethod.enabled) && (
              <button className="btn" style={{ flex: 1 }} disabled={!!redirecting} onClick={() => payByMobileMoney(p)}>
                {redirecting === `${p.id}-mm` ? 'Starting…' : mmMethod?.label ?? 'Mobile Money'}
              </button>
            )}
            {(!cardMethod || cardMethod.enabled) && (
              <button
                className="btn"
                style={{ flex: 1, background: '#2c3e50' }}
                disabled={!!redirecting}
                onClick={() => payByCard(p.id)}
              >
                {redirecting === `${p.id}-card` ? 'Redirecting…' : 'Pay by Card'}
              </button>
            )}
          </div>
        </div>
      ))}
    </main>
  );
}
