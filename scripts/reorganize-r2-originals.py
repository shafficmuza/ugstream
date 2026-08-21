#!/usr/bin/env python3
"""Move flat R2 originals into per-title folders, in place.

    python3 scripts/reorganize-r2-originals.py

The first pass of the migration wrote everything as
`originals/ep-<id>-<uid>.mp4`. This moves each object to its title's folder
and writes the transcoder manifest beside it:

    originals/your-honor/S01E03-ep267.mp4
    originals/your-honor/S01E03-ep267.json

Server-side copies only — the bytes never leave Cloudflare, so this costs no
egress and no Stream delivery minutes. Idempotent: an object already at its
destination is left alone, so this can be re-run after an interruption.
"""
import importlib.util
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('copier', os.path.join(HERE, 'copy-stream-to-r2.py'))
copier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(copier)

FLAT = re.compile(r'originals/ep-(\d+)-([0-9a-f]+)\.mp4(\.done)?$')


def main():
    e = copier.env()
    s3 = copier.r2_client(e)
    bucket = e['R2_BUCKET']
    rows = {r['uid']: r for r in copier.episodes()}

    objects = []
    for page in s3.get_paginator('list_objects_v2').paginate(Bucket=bucket, Prefix='originals/ep-'):
        objects.extend(page.get('Contents', []))

    moved = skipped = orphan = 0
    # Videos before markers, so an interrupted run never leaves a .done
    # marker pointing at a file that has not arrived yet.
    for obj in sorted(objects, key=lambda o: o['Key'].endswith('.done')):
        key = obj['Key']
        m = FLAT.match(key)
        if not m:
            continue
        row = rows.get(m.group(2))
        if not row:
            print(f'  orphan (no episode): {key}')
            orphan += 1
            continue

        dest = copier.key_for(row) + ('.done' if m.group(3) else '')
        if copier.head_size(s3, bucket, dest) is not None:
            s3.delete_object(Bucket=bucket, Key=key)
            skipped += 1
            continue

        s3.copy_object(Bucket=bucket, CopySource={'Bucket': bucket, 'Key': key}, Key=dest)
        s3.delete_object(Bucket=bucket, Key=key)

        if not m.group(3):
            size = copier.head_size(s3, bucket, dest) or 0
            s3.put_object(
                Bucket=bucket, Key=f'{dest[:-4]}.json',
                Body=json.dumps(copier.manifest_for(row, dest, size), indent=2).encode(),
                ContentType='application/json',
            )
            moved += 1
            print(f'  {row["slug"][:34]:34s} -> {dest}')

    print(f'moved={moved} already-there={skipped} orphaned={orphan}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
