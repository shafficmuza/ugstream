# Pre-made HLS ladder upload (adaptive 4K on R2, no server transcode)

You encode an adaptive HLS ladder on your own machine (or an on-demand VDS),
then upload the folder from the admin UI. It goes straight to R2 and is served
adaptive (multi-quality) — the app server never transcodes.

## 1. Encode the ladder on your machine (ffmpeg)

This produces a `master.m3u8` + one folder per quality. It only creates rungs
at or below the source resolution (never upscales), so a 1080p source yields
1080/720/480 and a true-4K source adds the 2160 rung.

```bash
INPUT="movie.mp4"          # your source (any resolution)
OUT="movie_hls"            # output folder to upload
mkdir -p "$OUT"

ffmpeg -y -i "$INPUT" \
  -filter_complex "\
[0:v]split=4[v0][v1][v2][v3];\
[v0]scale=w=-2:h=min(ih\,2160)[o0];\
[v1]scale=w=-2:h=min(ih\,1080)[o1];\
[v2]scale=w=-2:h=min(ih\,720)[o2];\
[v3]scale=w=-2:h=min(ih\,480)[o3]" \
  -map "[o0]" -map 0:a:0? -map "[o1]" -map 0:a:0? -map "[o2]" -map 0:a:0? -map "[o3]" -map 0:a:0? \
  -c:v libx264 -preset medium -profile:v high \
  -b:v:0 16000k -maxrate:v:0 16000k -bufsize:v:0 32000k \
  -b:v:1 6000k  -maxrate:v:1 6000k  -bufsize:v:1 12000k \
  -b:v:2 3000k  -maxrate:v:2 3000k  -bufsize:v:2 6000k \
  -b:v:3 1200k  -maxrate:v:3 1200k  -bufsize:v:3 2400k \
  -c:a aac -b:a 128k \
  -g 48 -keyint_min 48 -sc_threshold 0 \
  -var_stream_map "v:0,a:0 v:1,a:1 v:2,a:2 v:3,a:3" \
  -master_pl_name master.m3u8 \
  -f hls -hls_time 6 -hls_playlist_type vod \
  -hls_segment_filename "$OUT/stream_%v/seg_%03d.ts" \
  "$OUT/stream_%v/playlist.m3u8"
```

Rules that matter:
- **Video must be H.264** (`libx264`) — HEVC/H.265 won't play in most browsers.
- The master playlist **must be named `master.m3u8`** (the `-master_pl_name`
  flag above does this). The uploader also auto-detects the master by content
  and normalises its name, but naming it master.m3u8 is safest.
- Keep the folder structure ffmpeg produces (master + `stream_*/` subfolders).
- For an already-4K H.264 source you don't want to re-encode, drop the 2160
  rung's re-encode by using `-c:v:0 copy` for that map — advanced, optional.

## 2. Upload from the UI

1. Admin → Titles → click the title's **name** → edit page.
2. Scroll to **"Upload 4K (self-hosted on R2)"**.
3. Choose **"Pre-made HLS ladder (adaptive, recommended)"**.
4. Click the picker and **select the whole `movie_hls` folder** (the browser
   asks to confirm uploading the folder — allow it).
5. It uploads every file directly to R2 (progress shown), then publishes.
   The episode appears as **ready · 4K · R2 (adaptive)**.

## How it works under the hood

- `POST /admin/r2/hls/begin` mints a fresh R2 prefix `hls/pre-<uuid>/`.
- `POST /admin/r2/hls/sign-batch` presigns a PUT for every file (correct
  Content-Type per extension: m3u8 → mpegurl, ts → mp2t).
- The browser PUTs each file straight to R2 (6 at a time), bytes never touch
  the app server.
- `POST /admin/titles/:id/episodes/register-r2-hls` confirms master.m3u8
  landed, derives duration from the playlist (summing EXTINF, no segment
  downloads), and creates a ready `r2_hls` episode.
- Playback (`r2_hls`) is served from the public r2.dev URL; hls.js switches
  quality by bandwidth. Requires the bucket CORS policy (see
  4k-r2-architecture.md).
