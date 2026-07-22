'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { apiFetch } from './api';
import { getAccessToken, clearTokens as clearStoredTokens, setTokens as storeTokens } from './auth';

interface Me {
  id: string;
  phone: string;
  displayName: string | null;
  role: string;
}

interface AuthState {
  // undefined = still checking (avoids a login-link flash on first paint),
  // null = logged out, Me = logged in.
  me: Me | null | undefined;
  login: (accessToken: string, refreshToken: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null | undefined>(undefined);

  const refresh = useCallback(async () => {
    const token = getAccessToken();
    if (!token) {
      setMe(null);
      return;
    }
    try {
      setMe(await apiFetch<Me>('/me', { token }));
    } catch {
      // Token expired/invalid — clear it so the header doesn't keep
      // claiming the user is logged in.
      clearStoredTokens();
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

  return <AuthContext.Provider value={{ me, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
