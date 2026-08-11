#!/bin/bash
# Pick a real scene as the thumbnail for every ready Cloudflare episode.
#
#   bash scripts/backfill-episode-thumbnails.sh [--only-blank]
#
# Cloudflare's default still is a fixed early frame, so most of the catalogue
# shows a fade-in or a near-black frame. This walks every ready episode and
# runs the scene picker over it.
#
# --only-blank restricts the run to episodes whose current thumbnail is under
# 5KB, which is the signature of a blank or near-blank frame — useful for a
# second pass without redoing everything.
#
# Only ever updates thumbnails. No episode, title or video is deleted.
set -uo pipefail
cd /root/ugstream/backend

ONLY_BLANK=false
[ "${1:-}" = "--only-blank" ] && ONLY_BLANK=true

SID=$(docker compose -f ../docker-compose.yml exec -T postgres psql -U ugstream_user -d ugstream_db -tAc \
  "SELECT id FROM sessions WHERE user_id=5 AND revoked_at IS NULL ORDER BY last_seen_at DESC LIMIT 1;" | tr -d '[:space:]')
[ -n "$SID" ] || { echo "No active admin session to sign a token with." >&2; exit 1; }
TOKEN=$(node -e "
const jwt=require('jsonwebtoken');require('dotenv').config();
console.log(jwt.sign({sub:'5',sid:process.argv[1]},process.env.JWT_ACCESS_SECRET,{expiresIn:'240m'}));" "$SID")

rows=$(docker compose -f ../docker-compose.yml exec -T postgres psql -U ugstream_user -d ugstream_db -tAc \
  "SELECT e.id||'|'||e.title_id FROM episodes e
   WHERE e.cf_status='ready' AND e.video_provider='cloudflare' AND e.cf_video_uid IS NOT NULL
   ORDER BY e.id;")

total=$(printf '%s\n' "$rows" | grep -c .)
echo "$total ready Cloudflare episodes"
done_n=0; picked=0; skipped=0; failed=0

for row in $rows; do
  eid=${row%%|*}; tid=${row##*|}
  done_n=$((done_n+1))

  if $ONLY_BLANK; then
    sz=$(curl -sL -o /tmp/_th.jpg -w '%{size_download}' "https://ham.sentepos.com/api/v1/episodes/$eid/thumbnail" || echo 0)
    if [ "${sz:-0}" -ge 5000 ]; then
      skipped=$((skipped+1)); continue
    fi
  fi

  out=$(curl -s -m 180 -X POST \
    "http://localhost:4010/v1/admin/titles/$tid/episodes/$eid/thumbnail/auto" \
    -H "Authorization: Bearer $TOKEN")
  t=$(printf '%s' "$out" | python3 -c "
import json,sys
try: print(json.load(sys.stdin).get('chosenTimeSecs',''))
except Exception: print('')" 2>/dev/null)

  if [ -n "$t" ]; then
    picked=$((picked+1))
    printf '[%3d/%3d] ep %-5s -> %ss\n' "$done_n" "$total" "$eid" "$t"
  else
    failed=$((failed+1))
    printf '[%3d/%3d] ep %-5s FAILED: %s\n' "$done_n" "$total" "$eid" "$(printf '%s' "$out" | head -c 110)"
  fi
  sleep 0.4   # be kind to the Cloudflare API
done

echo
echo "picked $picked · skipped $skipped · failed $failed"
