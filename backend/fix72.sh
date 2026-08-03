#!/bin/bash
# Convert the already-uploaded 72 HOURS .mkv (valid H.264) into playable HLS.
# Video stream is COPIED (no re-encode, no quality loss, fast); only the MP3
# audio is converted to AAC, which HLS/AVPlayer require.
set -e
SRC="https://pub-554362ac6de74eb7816dfb210c110399.r2.dev/files/fad656ab-7b91-4690-a3bf-7dd0b4e0cec6-72-HOURS-EMMY.mkv"
OUT=/tmp/hls72
rm -rf $OUT && mkdir -p $OUT/stream_0
ffmpeg -hide_banner -y -i "$SRC" \
  -map 0:v:0 -map 0:a:0 \
  -c:v copy -c:a aac -b:a 160k -ac 2 \
  -f hls -hls_time 6 -hls_playlist_type vod \
  -hls_segment_filename "$OUT/stream_0/seg_%04d.ts" \
  "$OUT/stream_0/playlist.m3u8"
# Master playlist so the player sees a normal adaptive manifest.
cat > $OUT/master.m3u8 <<M
#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=2600000,RESOLUTION=1920x804,CODECS="avc1.640028,mp4a.40.2"
stream_0/playlist.m3u8
M
echo "TRANSCODE_DONE $(du -sh $OUT | cut -f1) $(ls $OUT/stream_0/*.ts | wc -l) segments"
