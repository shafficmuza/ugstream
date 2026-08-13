#!/bin/bash
# Swap the public catalogue between the full library and the public-domain set.
#
#   bash scripts/review-mode.sh on       # only public-domain titles are public
#   bash scripts/review-mode.sh off      # restore exactly what was public before
#   bash scripts/review-mode.sh status
#
# For the window while an app store is reviewing: the reviewer, and anyone else,
# sees the same catalogue. It is what makes "the app you showed them" and "the
# app your users get" the same app.
#
# Nothing is ever deleted. `on` records which titles were published, then
# publishes the test set and unpublishes the rest; `off` puts back precisely
# what the snapshot recorded. Episodes, artwork, watch history and the titles
# themselves are untouched throughout — only the published flag moves.
#
# Deliberately writes to the database rather than calling the admin API,
# because the publish endpoint announces new titles by push. Flipping 179
# titles through it would send a notification storm to every handset.
set -euo pipefail

MODE="${1:-status}"
SNAP=/root/secure/catalogue-snapshot.json
COMPOSE_DIR=/root/ugstream

psql_q() {
  docker compose -f "$COMPOSE_DIR/docker-compose.yml" exec -T postgres \
    psql -U ugstream_user -d ugstream_db -tAc "$1"
}

status() {
  psql_q "
    SELECT '  published:        '||count(*) FILTER (WHERE published)
        ||E'\n  of those, test:   '||count(*) FILTER (WHERE published AND is_test)
        ||E'\n  test titles:      '||count(*) FILTER (WHERE is_test)
        ||E'\n  total titles:     '||count(*)
    FROM titles;"
  if [ -f "$SNAP" ]; then
    echo "  REVIEW MODE IS ON — snapshot of $(python3 -c "
import json;print(len(json.load(open('$SNAP'))['published_ids']))") previously published titles at $SNAP"
  else
    echo "  review mode is off (no snapshot)"
  fi
}

case "$MODE" in
  status) status ;;

  on)
    if [ -f "$SNAP" ]; then
      echo "Review mode is already on — refusing to overwrite the snapshot at $SNAP." >&2
      echo "Run '$0 off' first if you meant to restore, then 'on' again." >&2
      exit 1
    fi
    mkdir -p "$(dirname "$SNAP")"
    ids=$(psql_q "SELECT string_agg(id::text, ',') FROM titles WHERE published;")
    [ -n "$ids" ] || { echo "Nothing is published; nothing to snapshot." >&2; exit 1; }
    python3 -c "
import json, sys, datetime
ids=[int(x) for x in '''$ids'''.split(',') if x.strip()]
json.dump({'taken_at': datetime.datetime.now().isoformat(timespec='seconds'),
           'published_ids': ids}, open('$SNAP','w'), indent=1)
print(f'  snapshot: {len(ids)} published titles recorded')"
    chmod 600 "$SNAP"

    psql_q "UPDATE titles SET published = is_test;" >/dev/null
    echo "  switched: only public-domain test titles are now public"
    status
    ;;

  off)
    [ -f "$SNAP" ] || { echo "No snapshot at $SNAP — nothing to restore." >&2; exit 1; }
    ids=$(python3 -c "
import json; print(','.join(str(i) for i in json.load(open('$SNAP'))['published_ids']))")
    [ -n "$ids" ] || { echo "Snapshot is empty; refusing to unpublish everything." >&2; exit 1; }
    psql_q "UPDATE titles SET published = (id IN ($ids));" >/dev/null
    mv "$SNAP" "$SNAP.restored-$(date +%Y%m%d-%H%M%S)"
    echo "  restored the catalogue exactly as it was before review mode"
    status
    ;;

  *) echo "usage: $0 on|off|status" >&2; exit 1 ;;
esac
