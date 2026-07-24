'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

/**
 * Netflix-style header search: a magnifier icon that expands into an
 * input. Typing navigates to /search?q=… (debounced) so results render
 * live as you type; clearing or closing returns to where you were.
 */
export function SearchBox() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const startedOnSearch = pathname === '/search';
  const [value, setValue] = useState(startedOnSearch ? (params.get('q') ?? '') : '');
  const [open, setOpen] = useState(startedOnSearch);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Where the user was before search took over navigation, so closing
  // the box can take them back there instead of always to "/".
  const origin = useRef('/');

  useEffect(() => {
    if (pathname !== '/search') origin.current = pathname ?? '/';
  }, [pathname]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  function navigate(q: string) {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      if (q) {
        router.replace(`/search?q=${encodeURIComponent(q)}`);
      } else if (pathname === '/search') {
        router.replace(origin.current);
      }
    }, 250);
  }

  function onChange(next: string) {
    setValue(next);
    navigate(next.trim());
  }

  function clearAndClose() {
    setValue('');
    setOpen(false);
    if (debounce.current) clearTimeout(debounce.current);
    if (pathname === '/search') router.replace(origin.current);
  }

  return (
    <div className={open ? 'nf-search open' : 'nf-search'}>
      <button
        className="nf-search-toggle"
        aria-label="Search"
        onClick={() => (open ? clearAndClose() : setOpen(true))}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
          <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
          <path d="M16.5 16.5 21 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
      <input
        ref={inputRef}
        type="text"
        placeholder="Titles, genres, VJs…"
        aria-label="Search titles"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => {
          // Collapse only when empty — keep it open while showing results.
          if (!value.trim()) setOpen(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') clearAndClose();
        }}
      />
      {value && (
        <button className="nf-search-clear" aria-label="Clear search" onClick={clearAndClose}>
          ✕
        </button>
      )}
    </div>
  );
}
