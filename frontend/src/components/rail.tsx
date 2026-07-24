'use client';

import { useRef } from 'react';

/**
 * Horizontal scroller with Netflix-style hover arrows. Children are the
 * cards; arrows page by ~90% of the visible width. On touch screens the
 * arrows are hidden (CSS) and native swipe scrolling takes over.
 */
export function Rail({ heading, children }: { heading: string; children: React.ReactNode }) {
  const scroller = useRef<HTMLDivElement>(null);

  function page(direction: 1 | -1) {
    const el = scroller.current;
    if (!el) return;
    el.scrollBy({ left: direction * el.clientWidth * 0.9, behavior: 'smooth' });
  }

  return (
    <section className="rail">
      <div className="rail-header">
        <h2>{heading}</h2>
      </div>
      <div className="rail-body">
        <button className="rail-arrow left" aria-label="Scroll left" onClick={() => page(-1)}>
          ‹
        </button>
        <div className="rail-scroller" ref={scroller}>
          {children}
        </div>
        <button className="rail-arrow right" aria-label="Scroll right" onClick={() => page(1)}>
          ›
        </button>
      </div>
    </section>
  );
}
