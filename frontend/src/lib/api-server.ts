import { cookies } from 'next/headers';

import { apiFetch } from './api';

/** Set by the API on sign-in and refresh; names the catalogue this account is on. */
const AUDIENCE_COOKIE = 'ugs_aud';
/** The session itself. httpOnly, so it exists here and nowhere in the browser's JS. */
const REFRESH_COOKIE = 'ugs_rt';

/**
 * A catalogue fetch made from a Server Component, on behalf of whoever is
 * browsing.
 *
 * The catalogue pages are server-rendered, so the browser's access token is
 * not available while Next builds the HTML — which meant every one of them
 * asked the API as an anonymous visitor and was answered with the live
 * catalogue. A signed-in tester saw published titles on the website while the
 * phone app, which does send its token, showed them the test catalogue.
 *
 * Both httpOnly cookies are forwarded so the API can work out who is asking.
 * The audience cookie has only two values, test and live, so on its own it
 * cannot describe an Early access account — one of those signed in on the
 * website was served the test catalogue while the phone app, which sends its
 * token, showed them everything. The session cookie resolves the real account
 * and settles it. Both decide what is DISPLAYED and grant nothing: playback is
 * checked against the account itself.
 *
 * Reading a cookie opts the page out of static rendering, which is correct:
 * the catalogue genuinely differs per viewer and must not be cached across
 * audiences.
 */
export function apiFetchAsViewer<T>(path: string): Promise<T> {
  const jar = cookies();
  const forwarded = [AUDIENCE_COOKIE, REFRESH_COOKIE]
    .map((name) => {
      const value = jar.get(name)?.value;
      return value ? `${name}=${value}` : null;
    })
    .filter(Boolean)
    .join('; ');
  return apiFetch<T>(path, { cookie: forwarded || undefined });
}
