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
