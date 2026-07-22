import { Suspense } from 'react';
import { CallbackContent } from './callback-content';

export default function PaymentsCallbackPage() {
  return (
    <main style={{ maxWidth: 480, margin: '120px auto', textAlign: 'center', padding: '0 20px' }}>
      <Suspense fallback={<p>Loading…</p>}>
        <CallbackContent />
      </Suspense>
    </main>
  );
}
