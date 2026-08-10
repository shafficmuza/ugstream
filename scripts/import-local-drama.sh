#!/bin/bash
# Bulk-import video files into the catalogue as Local Drama titles.
#
#   bash scripts/import-local-drama.sh [--publish] [dir]
#
# Reads every video file in `dir` (default /srv/muza-media), and for each one:
#   1. creates a Movie title, free access, tagged Local Drama;
#   2. tells Cloudflare to ingest the file from the public media URL.
#
# Cloudflare pulls the file itself, so nothing is uploaded twice and the ~200MB
# browser limit never applies. Titles are left UNPUBLISHED so you can set a
# poster and check the name before anything goes live; pass --publish to
# publish immediately instead.
#
# Only ever creates. Nothing is deleted, renamed or overwritten — a file whose
# slug already exists is skipped and reported, so re-running after a partial
# run is safe.
set -uo pipefail

PUBLISH=false
[ "${1:-}" = "--publish" ] && { PUBLISH=true; shift; }
DIR="${1:-/srv/muza-media}"
GENRE_LOCAL_DRAMA=4
API=http://localhost:4010/v1
PUBLIC_MEDIA=https://ham.sentepos.com/api/media
cd /root/ugstream/backend

[ -d "$DIR" ] || { echo "No such directory: $DIR" >&2; exit 1; }

# Admin token, minted from the live signing secret + a real session row.
SID=$(docker compose -f ../docker-compose.yml exec -T postgres psql -U ugstream_user -d ugstream_db -tAc \
  "SELECT id FROM sessions WHERE user_id=5 AND revoked_at IS NULL ORDER BY last_seen_at DESC LIMIT 1;" | tr -d '[:space:]')
[ -n "$SID" ] || { echo "No active admin session to sign a token with." >&2; exit 1; }
TOKEN=$(node -e "
const jwt=require('jsonwebtoken');require('dotenv').config();
console.log(jwt.sign({sub:'5',sid:process.argv[1]},process.env.JWT_ACCESS_SECRET,{expiresIn:'60m'}));" "$SID")

created=0; skipped=0; failed=0

shopt -s nullglob nocaseglob
for f in "$DIR"/*.{mp4,mkv,mov,m4v,webm,avi}; do
  base=$(basename "$f")
  # Human name: drop the extension, turn separators into spaces, collapse runs,
  # and strip any trailing [youtube-id] left by a downloader.
  name=$(printf '%s' "${base%.*}" \
        | sed -E 's/\[[A-Za-z0-9_-]{6,}\]//g; s/[._]+/ /g; s/-+/ /g; s/[[:space:]]+/ /g; s/^ +| +$//g')
  slug=$(printf '%s' "$name" | tr '[:upper:]' '[:lower:]' \
        | sed -E 's/[^a-z0-9]+/-/g; s/^-+|-+$//g')
  [ -n "$slug" ] || { echo "skip (no usable name): $base"; skipped=$((skipped+1)); continue; }

  body=$(python3 -c "
import json,sys
print(json.dumps({'kind':'movie','name':sys.argv[1],'slug':sys.argv[2],
 'access':'free','language':'Luganda','published':$( $PUBLISH && echo true || echo false ),
 'genreIds':[$GENRE_LOCAL_DRAMA]}))" "$name" "$slug")

  resp=$(curl -s -w '\n%{http_code}' -X POST "$API/admin/titles" \
        -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d "$body")
  code=$(printf '%s' "$resp" | tail -1); json=$(printf '%s' "$resp" | sed '$d')

  if [ "$code" = "409" ]; then
    echo "skip (already exists): $name"; skipped=$((skipped+1)); continue
  fi
  if [ "$code" != "201" ] && [ "$code" != "200" ]; then
    echo "FAILED to create ($code): $name"; failed=$((failed+1)); continue
  fi

  tid=$(printf '%s' "$json" | python3 -c "import json,sys;print(json.load(sys.stdin)['id'])")
  url="$PUBLIC_MEDIA/$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" "$base")"

  icode=$(curl -s -o /tmp/import.out -w '%{http_code}' -X POST \
        "$API/admin/titles/$tid/episodes/import-url" \
        -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
        -d "$(python3 -c "import json,sys;print(json.dumps({'url':sys.argv[1],'name':sys.argv[2],'season':1,'number':1}))" "$url" "$name")")

  if [ "$icode" = "201" ] || [ "$icode" = "200" ]; then
    echo "created + ingesting: $name  (title $tid)"; created=$((created+1))
  else
    echo "created but INGEST FAILED ($icode): $name  (title $tid)"; failed=$((failed+1))
  fi
done

echo
echo "created $created · skipped $skipped · failed $failed"
echo "Cloudflare is encoding in the background; titles turn 'ready' on their own."
echo "Check progress:  Admin → Titles, or the episodes table."
