import { apiFetch } from './api';

export interface AppSettings {
  appName: string;
  logoUrl: string | null;
  tagline: string | null;
  supportEmail: string | null;
  supportPhone: string | null;
  heroBackgroundUrl: string | null;
  authBackgroundUrl: string | null;
  mobileMoneyProvider?: string;
}

const DEFAULT_SETTINGS: AppSettings = {
  appName: 'ugstream',
  logoUrl: null,
  tagline: null,
  supportEmail: null,
  supportPhone: null,
  heroBackgroundUrl: null,
  authBackgroundUrl: null,
  mobileMoneyProvider: 'momo',
};

export async function fetchSettings(): Promise<AppSettings> {
  try {
    return await apiFetch<AppSettings>('/settings');
  } catch {
    // Backend unreachable (e.g. first local run) — fall back rather than
    // crash the whole page render over branding.
    return DEFAULT_SETTINGS;
  }
}
