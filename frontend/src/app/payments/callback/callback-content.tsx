'use client';

import { useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { getAccessToken } from '@/lib/auth';

export function CallbackContent() {
  const params = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState<'checking' | 'success' | 'pending' | 'failed'>('checking');

  useEffect(() => {
    // Flutterwave appends tx_ref/status/transaction_id to the redirect URL.
    // The webhook is the source of truth for granting entitlement — this
    // page just polls our own /payments/:id until that's landed.
    const flwStatus = params.get('status');
    if (flwStatus === 'cancelled') {
      setStatus('failed');
      return;
    }

    // The subscribe page stashes our internal payment id in sessionStorage
    // before redirecting to Flutterwave; we poll that record here rather
    // than trusting query params on the redirect (which the user's browser
    // controls) as proof of payment.
    const token = getAccessToken();
    if (!token) {
      setStatus('failed');
      return;
    }

    let attempts = 0;
    const poll = setInterval(async () => {
      attempts += 1;
      const paymentId = sessionStorage.getItem('ugstream_pending_payment_id');
      if (!paymentId) {
        clearInterval(poll);
        setStatus('pending');
        return;
      }
      try {
        const res = await apiFetch<{ status: string }>(`/payments/${paymentId}`, { token });
        if (res.status === 'successful') {
          clearInterval(poll);
          setStatus('success');
          setTimeout(() => router.push('/'), 1500);
        } else if (res.status === 'failed' || attempts > 20) {
          clearInterval(poll);
          setStatus('failed');
        }
      } catch {
        if (attempts > 20) {
          clearInterval(poll);
          setStatus('failed');
        }
      }
    }, 2000);

    return () => clearInterval(poll);
  }, [params, router]);

  const messages = {
    checking: 'Confirming your payment…',
    success: 'Payment confirmed! Redirecting…',
    pending: "We're still waiting for confirmation — this can take a minute.",
    failed: 'Payment was not completed. You can try again from the subscribe page.',
  };

  return <p>{messages[status]}</p>;
}
