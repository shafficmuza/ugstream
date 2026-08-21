#!/bin/bash
# Supervise the Stream→R2 copy until the whole library is verified.
#
#   setsid nohup bash scripts/run-r2-copy.sh >> r2-copy.log 2>&1 &
#
# The copier is idempotent — anything with a .done marker in R2 is skipped —
# so the safe response to any interruption is simply to run it again. A pass
# died silently once (killed by a signal, no traceback), which no amount of
# exception handling inside the script would have survived. This loops until
# every video is verified or the passes run out.
#
# Deliberately nice'd: this box also serves the platform, and a background
# migration must never be the reason a viewer waits.
set -u

cd "$(dirname "$0")/.."

MAX_PASSES=${MAX_PASSES:-20}
WORKERS=${WORKERS:-2}
TOTAL=${TOTAL:-256}

verified() {
  python3 - <<'PY' 2>/dev/null || echo 0
import importlib.util
spec = importlib.util.spec_from_file_location('c', 'scripts/copy-stream-to-r2.py')
c = importlib.util.module_from_spec(spec); spec.loader.exec_module(c)
e = c.env(); s3 = c.r2_client(e)
n = 0
for page in s3.get_paginator('list_objects_v2').paginate(Bucket=e['R2_BUCKET'], Prefix='originals/'):
    n += sum(1 for o in page.get('Contents', []) if o['Key'].endswith('.done'))
print(n)
PY
}

for pass_no in $(seq 1 "$MAX_PASSES"); do
  have=$(verified)
  echo "=== pass $pass_no/$MAX_PASSES — $have/$TOTAL verified ==="
  if [ "$have" -ge "$TOTAL" ]; then
    echo "ALL DONE: $have/$TOTAL verified"
    exit 0
  fi

  nice -n 10 python3 scripts/copy-stream-to-r2.py --workers "$WORKERS"
  echo "pass $pass_no exited with status $?"
  sleep 20
done

echo "STOPPED after $MAX_PASSES passes — $(verified)/$TOTAL verified"
