/**
 * Signed HLS delivery Worker for Ham Watch 4K.
 *
 * Sits in front of the R2 bucket (bound as `BUCKET`) on a custom domain
 * (e.g. cdn.ham.sentepos.com). Every request must carry a valid `?t=<jwt>`
 * token minted by the backend (see backend/src/media-storage/hls-token.ts) —
 * same HS256 secret (`HLS_TOKEN_SECRET`), same JWT shape. The token
 * authorises everything under one R2 prefix until it expires, so the
 * player can fetch the master playlist, variant playlists and every .ts
 * segment with the one token.
 *
 * The player appends `?t=` to every request (hls.js xhrSetup), so segment
 * requests carry it too even though the playlists use relative URLs.
 */

function b64urlToBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function verifyToken(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, payload, sig] = parts;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const ok = await crypto.subtle.verify(
    'HMAC',
    key,
    b64urlToBytes(sig),
    new TextEncoder().encode(`${header}.${payload}`),
  );
  if (!ok) return null;

  let claims;
  try {
    claims = JSON.parse(new TextDecoder().decode(b64urlToBytes(payload)));
  } catch {
    return null;
  }
  if (!claims.exp || claims.exp < Math.floor(Date.now() / 1000)) return null;
  return claims;
}

const CONTENT_TYPES = {
  m3u8: 'application/vnd.apple.mpegurl',
  ts: 'video/mp2t',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const key = decodeURIComponent(url.pathname.replace(/^\/+/, ''));

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    const token = url.searchParams.get('t');
    if (!token) return new Response('Missing token', { status: 401 });

    const claims = await verifyToken(token, env.HLS_TOKEN_SECRET);
    if (!claims) return new Response('Invalid or expired token', { status: 403 });

    // Token is scoped to a prefix — the requested object must live under it.
    if (!key.startsWith(claims.prefix)) {
      return new Response('Forbidden', { status: 403 });
    }

    const object = await env.BUCKET.get(key);
    if (!object) return new Response('Not found', { status: 404 });

    const ext = key.split('.').pop();
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);
    if (CONTENT_TYPES[ext]) headers.set('content-type', CONTENT_TYPES[ext]);
    // Playlists must stay fresh; segments are immutable and cache hard.
    headers.set('cache-control', ext === 'm3u8' ? 'no-cache' : 'public, max-age=31536000, immutable');

    return new Response(request.method === 'HEAD' ? null : object.body, { headers });
  },
};
