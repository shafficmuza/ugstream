'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

/**
 * Header search. Typing navigates to /search?q=… (debounced) so results
 * render live as you type; clearing it returns to where you were.
 */
export function SearchBox() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [value, setValue] = useState(pathname === '/search' ? (params.get('q') ?? '') : '');
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Where the user was before search took over navigation, so clearing
  // the box can take them back there instead of always to "/".
  const origin = useRef('/');

  useEffect(() => {
    if (pathname !== '/search') origin.current = pathname ?? '/';
  }, [pathname]);

  function onChange(next: string) {
    setValue(next);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      const q = next.trim();
      if (q) {
        router.replace(`/search?q=${encodeURIComponent(q)}`);
      } else if (pathname === '/search') {
        router.replace(origin.current);
      }
    }, 250);
  }

  return (
    <div className="nf-search">
      <input
        type="search"
        placeholder="Search titles…"
        aria-label="Search titles"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
