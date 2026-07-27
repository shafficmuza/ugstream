# True 4K delivery — self-hosted HLS on Cloudflare R2

Cloudflare Stream caps playback at **1080p** — it cannot deliver 4K. To
serve genuine 2160p "like Netflix", Ham Watch has a second video path that
transcodes 4K itself and delivers from Cloudflare R2 (which has **$0
egress** — decisive for video economics). Cloudflare Stream stays the
default; the R2 path is opt-in per episode.

## Pipeline

```
Admin → POST /v1/admin/titles/:id/episodes/transcode-4k { url }
   │
   ├─ EpisodesService.transcode4k → creates episode (videoProvider='r2_hls', status uploading)
   │
   ▼ TranscodeService.startTranscode  (Contabo VPS — has ffmpeg + the CPU)
       ffprobe duration
       ffmpeg single-pass ladder → 2160p / 1080p / 720p / 480p (H.264 High) + master.m3u8
       upload hls/ep-<id>/… to R2
       episode → status ready, r2Prefix set, duration recorded
   │
   ▼ playback: EpisodesService.play() branches on videoProvider
       cloudflare → Cloudflare Stream signed URL (unchanged)
       r2_hls    → https://<R2_PUBLIC_HOST>/hls/ep-<id>/master.m3u8  +  signed HLS token
   │
   ▼ Cloudflare Worker (infra/r2-hls-worker) on cdn.ham.sentepos.com
       verifies ?t=<jwt> (HS256, prefix-scoped, expiring) → serves the R2 object
   │
   ▼ hls.js (watch-player.tsx) appends ?t=<token> to every request
```

## Why this shape

- **Encode on the VPS, deliver on R2.** Encoding is CPU-heavy but free on
  hardware already paid for; delivery must be global + scalable + cheap,
  which R2 + the Cloudflare edge give with zero egress.
- **Signed, prefix-scoped tokens** replicate the Stream signed-URL
  protection model. A token for `hls/ep-12/` can't read another title; it
  expires (default 1h). The bucket is never public — all reads go through
  the Worker.
- **H.264 High** on every rung for universal browser support (incl. 4K via
  hls.js). HEVC/AV1 would cut bandwidth ~40–50% but need per-browser
  fallbacks — a later optimisation.
- `scale=-2:min(ih,H)` never upscales: a 1080p source simply omits a real
  4K rung instead of faking one.

## Setup checklist

Backend `.env` (gitignored):
```
R2_ACCOUNT_ID=…            # provided: c716599…266a0
R2_ACCESS_KEY_ID=…         # R2 → Manage API Tokens
R2_SECRET_ACCESS_KEY=…
R2_BUCKET=…                # e.g. ham-hls
R2_PUBLIC_HOST=…           # e.g. cdn.ham.sentepos.com (the Worker route)
R2_HLS_TOKEN_SECRET=…      # already generated; copy the SAME value to the Worker
```

Worker: see `infra/r2-hls-worker/README.md` — set `bucket_name`, put
`HLS_TOKEN_SECRET` (= `R2_HLS_TOKEN_SECRET`), `wrangler deploy`, route
`cdn.ham.sentepos.com/*` at it.

Then: `POST /v1/admin/titles/:id/episodes/transcode-4k { "url": "https://…/master.mp4" }`
and the title plays back at true 4K.

## Status / cost notes

- The ffmpeg ladder is verified locally against a 4K NASA master — it
  produces a valid master.m3u8 with a real 3840×2160 rung. End-to-end R2
  delivery is pending the API token + bucket + Worker route.
- 4K encoding is CPU-bound: budget roughly real-time-to-several-x per title
  on the VPS at `-preset veryfast`. Consider a job queue if many titles are
  transcoded at once (currently fire-and-forget per request).
- No DRM (Widevine/FairPlay/PlayReady) — protection is signed URLs +
  segmenting, same as the Stream path. Add a DRM/license server later if
  licensed studio content requires it.

## CORS (REQUIRED for hls.js playback)

hls.js fetches every playlist and .ts segment via XHR, so the R2 bucket MUST
send `Access-Control-Allow-Origin` for the app origin — otherwise the browser
blocks all segment fetches and playback fails silently on every device (the
`<video>`/master URL loads fine, but nothing plays). The public r2.dev domain
sends NO CORS headers by default.

Set the bucket CORS policy once (S3 PutBucketCors with the R2 keys):

    AllowedOrigins: ['https://ham.sentepos.com', 'http://localhost:3000']
    AllowedMethods: ['GET', 'HEAD']
    AllowedHeaders:  ['*']
    ExposeHeaders:   ['Content-Length', 'Content-Range', 'ETag']

Verify:  curl -sI -H "Origin: https://ham.sentepos.com" \
  https://<pub-host>.r2.dev/hls/ep-N/master.m3u8 | grep -i access-control
Any NEW bucket used for HLS delivery needs this same policy applied.
