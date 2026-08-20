import { cookies } from 'next/headers';

import { apiFetch } from './api';

/** Set by the API on sign-in and refresh; names the catalogue this account is on. */
const AUDIENCE_COOKIE = 'ugs_aud';

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
 * The audience cookie exists precisely to close that gap: it is httpOnly,
 * travels with the page request, and says which catalogue the account is on.
 * Forwarding it is all that was missing. It decides what is DISPLAYED and
 * grants nothing — playback is checked against the account itself.
 *
 * Reading a cookie opts the page out of static rendering, which is correct:
 * the catalogue genuinely differs per viewer and must not be cached across
 * audiences.
 */
export function apiFetchAsViewer<T>(path: string): Promise<T> {
  const audience = cookies().get(AUDIENCE_COOKIE)?.value;
  return apiFetch<T>(path, {
    cookie: audience ? `${AUDIENCE_COOKIE}=${audience}` : undefined,
  });
}
