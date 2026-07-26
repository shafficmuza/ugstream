import { createHmac } from 'crypto';

/**
 * Minimal HS256 JWT for signed HLS delivery. Deliberately dependency-free
 * and format-identical to what the Cloudflare Worker verifies with Web
 * Crypto (SubtleCrypto) — same secret, same base64url JWT shape. The token
 * authorises playback of everything under one R2 prefix until `exp`.
 */
function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function signHlsToken(prefix: string, secret: string, expiresInSeconds = 3600): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(
    JSON.stringify({ prefix, exp: Math.floor(Date.now() / 1000) + expiresInSeconds }),
  );
  const data = `${header}.${payload}`;
  const sig = b64url(createHmac('sha256', secret).update(data).digest());
  return `${data}.${sig}`;
}
