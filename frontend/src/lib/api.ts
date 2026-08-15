import { getRefreshToken, refreshAccessToken } from './auth';

import { API_BASE } from './api-base';

export interface ApiError {
  statusCode: number;
  message: string;
  reason?: string;
  options?: unknown;
}

/**
 * Fetch wrapper with automatic token refresh. Access tokens are short-lived
 * (15 min); on a 401 we transparently exchange the 30-day refresh token for a
 * new access token and retry the request once. This is what keeps a session
 * alive across long activity (watching a movie, uploading) instead of
 * "timing out" after 15 minutes.
 */
export async function apiFetch<T>(
  path: string,
  opts: { method?: string; body?: unknown; token?: string } = {},
): Promise<T> {
  const send = (token?: string) =>
    fetch(`${API_BASE}${path}`, {
      method: opts.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      cache: 'no-store',
    });

  let res = await send(opts.token);

  // Expired access token → refresh once and retry. Attempted even with no
  // refresh token in localStorage: the httpOnly cookie copy may still hold
  // the session (Safari purges localStorage after 7 idle days; the cookie
  // survives).
  if (res.status === 401 && opts.token && typeof window !== 'undefined') {
    const fresh = await refreshAccessToken();
    if (fresh) {
      res = await send(fresh);
    } else if (getRefreshToken()) {
      // The refresh could not COMPLETE (deploy in progress, bad signal) but
      // the session was not refused — the stored token survived. Surfacing
      // the original 401 here would bounce the user to the login screen and
      // read as "the app signed me out"; report it as the outage it is.
      const transient: ApiError = {
        statusCode: 503,
        message: 'Connection problem — please try again in a moment.',
      };
      throw transient;
    }
  }

  const json = await res.json().catch(() => undefined);
  if (!res.ok) {
    const err: ApiError = {
      statusCode: res.status,
      message: json?.message ?? res.statusText,
      reason: json?.reason,
      options: json?.options,
    };
    throw err;
  }
  return json as T;
}
