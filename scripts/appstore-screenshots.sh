#!/bin/bash
# Turn screenshots taken on an iPhone into the exact sizes App Store Connect
# accepts.
#
#   bash scripts/appstore-screenshots.sh <dir-with-screenshots> [outdir]
#
# Produces, for every image found:
#   6.5in/  1242x2688   (iPhone 11 Pro Max / XS Max slot)
#   6.7in/  1284x2778   (iPhone 12/13/14 Pro Max slot)
#
# Why this exists: a screenshot from a modern iPhone is 1290x2796 or
# 1320x2868, and App Store Connect rejects anything that is not exactly one of
# its listed sizes. The aspect ratios are near-identical (19.5:9), so the fix
# is a clean scale — but "near-identical" is not identical, and a plain resize
# to a slightly different ratio stretches faces. This scales to fit and pads
# the remainder with the screenshot's own edge colour, so nothing is distorted
# and nothing is cropped away.
set -euo pipefail

SRC="${1:-}"
OUT="${2:-/root/ugstream/brand/screenshots}"
[ -n "$SRC" ] && [ -d "$SRC" ] || { echo "usage: $0 <dir-with-screenshots> [outdir]" >&2; exit 1; }

mkdir -p "$OUT/6.5in" "$OUT/6.7in"

python3 - "$SRC" "$OUT" <<'PY'
import sys, os, glob
from PIL import Image

src, out = sys.argv[1], sys.argv[2]
TARGETS = [('6.5in', 1242, 2688), ('6.7in', 1284, 2778)]

files = sorted(
    f for ext in ('png', 'jpg', 'jpeg', 'PNG', 'JPG')
    for f in glob.glob(os.path.join(src, f'*.{ext}'))
)
if not files:
    print(f'No images in {src}', file=sys.stderr); sys.exit(1)

print(f'{len(files)} screenshot(s)')
for i, path in enumerate(files, 1):
    im = Image.open(path).convert('RGB')
    w, h = im.size
    if h < w:
        print(f'  {os.path.basename(path)}: landscape ({w}x{h}) — skipped, '
              f'these targets are portrait')
        continue

    for name, tw, th in TARGETS:
        # Scale to fit inside the target, preserving aspect.
        scale = min(tw / w, th / h)
        nw, nh = round(w * scale), round(h * scale)
        resized = im.resize((nw, nh), Image.LANCZOS)

        # Pad with the colour at the top edge, so letterboxing reads as part of
        # the app's own background rather than a black band.
        edge = resized.getpixel((nw // 2, 0))
        canvas = Image.new('RGB', (tw, th), edge)
        canvas.paste(resized, ((tw - nw) // 2, (th - nh) // 2))

        dest = os.path.join(out, name, f'{i:02d}.png')
        canvas.save(dest, 'PNG', optimize=True)
        print(f'  {os.path.basename(path)} {w}x{h} -> {name}/{i:02d}.png {tw}x{th}')

print(f'\nwritten to {out}/')
PY
