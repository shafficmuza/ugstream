'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { apiFetch, ApiError } from './api';
import {
  getAccessToken,
  getRefreshToken,
  refreshAccessToken,
  clearTokens as clearStoredTokens,
  setTokens as storeTokens,
} from './auth';

interface Me {
  id: string;
  phone: string;
  displayName: string | null;
  email: string | null;
  address: string | null;
  role: string;
  /** Whether a sign-in PIN is set. Never the PIN itself. */
  pinSet?: boolean;
}

interface AuthState {
  // undefined = still checking (avoids a login-link flash on first paint),
  // null = logged out, Me = logged in.
  me: Me | null | undefined;
  login: (accessToken: string, refreshToken: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null | undefined>(undefined);

  const refresh = useCallback(async function attemptLoad(attempt = 0): Promise<void> {
    let token = getAccessToken();
    if (!token) {
      // Nothing in localStorage — but the session may still live in the
      // httpOnly cookie (Safari purges script storage after 7 idle days).
      // Recover it silently rather than showing the login screen.
      token = await refreshAccessToken();
      if (!token) {
        setMe(null);
        return;
      }
    }
    try {
      setMe(await apiFetch<Me>('/me', { token }));
    } catch (e) {
      const err = e as ApiError;
      // End the session ONLY when the server definitively refused it (the
      // 401 survived a refresh attempt and the refresh token is gone). A
      // deploy 502, backend warm-up, or bad signal must never destroy a
      // month-old session — that is exactly the "why am I logged out again"
      // Netflix never inflicts.
      if (err.statusCode === 401 && !getRefreshToken()) {
        clearStoredTokens();
        setMe(null);
        return;
      }
      if (attempt < 2) {
        setTimeout(() => void attemptLoad(attempt + 1), 5000);
        return; // stay in "checking" rather than flashing a logged-out header
      }
      // Give up for this visit — tokens stay put, the next visit recovers.
      setMe(null);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Called right after a successful OTP verify. Updating this shared
  // context (rather than component-local state in the header) is what
  // makes the logged-in state show up immediately — a plain client-side
  // router.push() does NOT remount the persistent root-layout header, so
  // any auth check living only in the header's own useEffect never re-runs
  // until a full page reload.
  const login = useCallback(
    async (accessToken: string, refreshToken: string) => {
      storeTokens(accessToken, refreshToken);
      await refresh();
    },
    [refresh],
  );

  const logout = useCallback(async () => {
    const token = getAccessToken();
    if (token) {
      await apiFetch('/auth/logout', { method: 'POST', token }).catch(() => {});
    }
    clearStoredTokens();
    setMe(null);
  }, []);

  return <AuthContext.Provider value={{ me, login, logout, refresh }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
