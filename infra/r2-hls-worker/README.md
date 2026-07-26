# Ham Watch — Signed HLS Delivery Worker (4K on R2)

Fronts the R2 bucket that holds self-transcoded 4K HLS. Validates a signed
token on every request so playback stays protected, exactly like the
Cloudflare Stream signed-URL model — but at true 2160p, which Stream can't do.

## How it fits together

```
Admin → POST /admin/titles/:id/episodes/transcode-4k { url }
          │
Contabo VPS (backend TranscodeService): ffmpeg 2160p/1080p/720p/480p ladder
          │  uploads hls/ep-<id>/… to R2
          ▼
Cloudflare R2  ◄────────  this Worker (cdn.ham.sentepos.com)  ◄──── player
   (storage, $0 egress)     verifies ?t=<jwt>, serves object      (hls.js)
```

The backend mints a short-lived HS256 token scoped to the episode's R2
prefix (`backend/src/media-storage/hls-token.ts`). The player appends it to
every request (`?t=…`). This Worker verifies it with the **same secret**
before serving any object.

## Deploy

```bash
cd infra/r2-hls-worker
npm i -g wrangler          # if needed
wrangler login

# 1. Set the bucket name in wrangler.toml (bucket_name = "...").
# 2. Set the shared secret — must equal the backend's R2_HLS_TOKEN_SECRET:
wrangler secret put HLS_TOKEN_SECRET

# 3. Publish, then route your CDN hostname at it:
wrangler deploy
#    Cloudflare dashboard → Workers → Routes:  cdn.ham.sentepos.com/*  → ham-hls-delivery
#    (add cdn.ham.sentepos.com as a DNS record proxied through Cloudflare)
```

Then set `R2_PUBLIC_HOST=cdn.ham.sentepos.com` in the backend `.env`.

## Security notes

- Token is prefix-scoped: a token for `hls/ep-12/` cannot read `hls/ep-13/`.
- Tokens expire (default 1h); playback of a long movie survives because the
  token covers the whole title for the session — re-request `/play` to renew.
- Only GET/HEAD are allowed; the bucket is never public — all reads go
  through this Worker's token check.
