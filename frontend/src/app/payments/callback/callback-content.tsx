'use client';

import { useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';

export function CallbackContent() {
  const params = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState<'checking' | 'success' | 'pending' | 'failed'>('checking');
  const [fromApp, setFromApp] = useState(false);

  useEffect(() => {
    if (params.get('status') === 'cancelled') {
      setStatus('failed');
      return;
    }

    // Poll by the provider reference in the URL rather than anything stored
    // in this browser. A payment started in the mobile app redirects into a
    // browser with no session and no sessionStorage, which used to leave
    // this page stuck on "waiting for confirmation" forever even though the
    // payment had succeeded. The reference is opaque and the endpoint
    // returns only a status, so it needs no login.
    const txRef = params.get('tx_ref');
    if (!txRef) {
      setStatus('pending');
      return;
    }

    // No session here means the payment almost certainly began in the app,
    // so send them back there rather than to the website.
    setFromApp(typeof window !== 'undefined' && !window.localStorage.getItem('ugstream_access_token'));

    let attempts = 0;
    const poll = setInterval(async () => {
      attempts += 1;
      try {
        const res = await apiFetch<{ status: string }>(`/payments/by-ref/${encodeURIComponent(txRef)}`);
        if (res.status === 'successful') {
          clearInterval(poll);
          setStatus('success');
          if (!fromApp) setTimeout(() => router.push('/'), 1800);
        } else if (res.status === 'failed' || attempts > 30) {
          clearInterval(poll);
          setStatus(res.status === 'failed' ? 'failed' : 'pending');
        }
      } catch {
        if (attempts > 30) {
          clearInterval(poll);
          setStatus('pending');
        }
      }
    }, 2000);

    return () => clearInterval(poll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, router]);

  if (status === 'success') {
    return (
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 44, marginBottom: 8 }}>✅</div>
        <h2 style={{ fontSize: 20, marginBottom: 8 }}>Payment confirmed</h2>
        <p style={{ opacity: 0.75 }}>
          {fromApp
            ? 'Your subscription is active — you can close this page and return to the app.'
            : 'Your subscription is active. Taking you back…'}
        </p>
      </div>
    );
  }

  const messages: Record<'checking' | 'pending' | 'failed', string> = {
    checking: 'Confirming your payment…',
    pending:
      "We haven't received confirmation yet. If you completed the payment it will activate shortly — reopen the app or refresh in a minute.",
    failed: 'Payment was not completed. You can try again from the subscribe page.',
  };

  return (
    <div style={{ textAlign: 'center' }}>
      <p>{messages[status]}</p>
      {status === 'checking' && (
        <p style={{ opacity: 0.5, fontSize: 13, marginTop: 8 }}>This usually takes a few seconds.</p>
      )}
    </div>
  );
}
