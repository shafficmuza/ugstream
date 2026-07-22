const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:4001/v1';

export interface ApiError {
  statusCode: number;
  message: string;
  reason?: string;
  options?: unknown;
}

/**
 * Thin fetch wrapper. Access tokens are short-lived (15 min); the caller is
 * responsible for retrying once after a 401 by hitting /auth/refresh — kept
 * out of this helper to avoid hidden infinite-retry loops.
 */
export async function apiFetch<T>(
  path: string,
  opts: { method?: string; body?: unknown; token?: string } = {},
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: opts.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    cache: 'no-store',
  });

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
