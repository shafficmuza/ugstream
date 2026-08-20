import { apiFetch } from './api';

export interface AppSettings {
  /** 'test' | 'live' — which catalogue the whole site serves. */
  catalogueMode?: string;
  appName: string;
  logoUrl: string | null;
  tagline: string | null;
  supportEmail: string | null;
  supportPhone: string | null;
  supportWhatsapp: string | null;
  supportHours: string | null;
  heroBackgroundUrl: string | null;
  authBackgroundUrl: string | null;
  mobileMoneyProvider?: string;
  smsProvider?: string;
  maxSessions?: number;
  maxStreams?: number;
  otpCooldownSeconds?: number;
  otpPerHour?: number;
  otpPerDay?: number;
}

const DEFAULT_SETTINGS: AppSettings = {
  // Matches the server's fail-closed default: if settings cannot be read we
  // assume test mode rather than implying the live catalogue is showing.
  catalogueMode: 'test',
  appName: 'ugstream',
  logoUrl: null,
  tagline: null,
  supportEmail: null,
  supportPhone: null,
  supportWhatsapp: null,
  supportHours: null,
  heroBackgroundUrl: null,
  authBackgroundUrl: null,
  mobileMoneyProvider: 'momo',
  smsProvider: 'auto',
  maxSessions: 3,
  maxStreams: 2,
  otpCooldownSeconds: 60,
  otpPerHour: 3,
  otpPerDay: 10,
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
