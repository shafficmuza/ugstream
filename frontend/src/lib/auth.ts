'use client';

// Deliberately simple localStorage-based token storage for the MVP.
// Fine for a phone-OTP consumer app; revisit (httpOnly cookies) if XSS
// surface grows once user-generated content (comments, etc.) is added.

const ACCESS_KEY = 'ugstream_access_token';
const REFRESH_KEY = 'ugstream_refresh_token';

export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(ACCESS_KEY);
}

export function getRefreshToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(REFRESH_KEY);
}

export function setTokens(accessToken: string, refreshToken: string) {
  window.localStorage.setItem(ACCESS_KEY, accessToken);
  window.localStorage.setItem(REFRESH_KEY, refreshToken);
}

export function clearTokens() {
  window.localStorage.removeItem(ACCESS_KEY);
  window.localStorage.removeItem(REFRESH_KEY);
}

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:4001/v1';

// Dedupe concurrent refreshes — a burst of 401s (e.g. many parallel upload
// chunk-sign calls) must trigger exactly one /auth/refresh, not a stampede.
let refreshInFlight: Promise<string | null> | null = null;

/**
 * Exchange the rotating refresh token for a fresh access token (the backend
 * rotates both). Works even with nothing in localStorage: the session also
 * lives in a long-lived httpOnly cookie the server reads when the body has
 * no token — that copy survives Safari purging script-writable storage after
 * 7 days without a visit, so a returning visitor is signed back in silently
 * instead of being sent to the login screen. Returns the new access token,
 * or null if refresh isn't possible; tokens are cleared only when the server
 * definitively refuses the session (401/403), never on a network failure.
 */
export function refreshAccessToken(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const refreshToken = getRefreshToken();
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Same-origin fetch carries the httpOnly cookie by default — no
        // credentials option needed.
        body: JSON.stringify(refreshToken ? { refreshToken } : {}),
      });
      // Only the server actively refusing the token ends a session. Clearing
      // on any non-OK response meant a 502 from the proxy, or a backend
      // restart, silently logged people out — and looked to them like the app
      // timing out while they watched something.
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) clearTokens();
        return null;
      }
      const json = await res.json();
      if (json?.accessToken && json?.refreshToken) {
        setTokens(json.accessToken, json.refreshToken);
        return json.accessToken as string;
      }
      return null;
    } catch {
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}
