'use client';

import { useRouter } from 'next/navigation';

/**
 * Floating back arrow for full-page views (title detail, browse). Uses
 * browser history when there's somewhere to go back to, otherwise falls
 * back to the home page so it's never a dead end (e.g. when the page was
 * opened directly from a shared link).
 */
export function BackButton() {
  const router = useRouter();

  function goBack() {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
    } else {
      router.push('/');
    }
  }

  return (
    <button className="back-fab" onClick={goBack} aria-label="Go back" title="Back">
      <span aria-hidden>←</span>
    </button>
  );
}
