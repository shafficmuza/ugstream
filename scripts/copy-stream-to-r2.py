#!/usr/bin/env python3
"""Copy every Cloudflare Stream master into R2, as plain storage.

    python3 scripts/copy-stream-to-r2.py [--limit N] [--workers N] [--dry-run]

Deliberately changes nothing about how the platform works. It writes no
application code, no database columns and no settings: episodes keep
video_provider='cloudflare' and their cf_video_uid, playback is untouched,
and the mobile apps neither know nor care that a second copy exists. The
files simply land in R2, ready for a transcoding pipeline to be built against
them later.

Each video takes three steps: ask Stream for an MP4 rendition (built lazily,
minutes per video), mint a token allowed to fetch it, then move the bytes.
The bytes are piped straight from Cloudflare into an R2 multipart upload and
never touch this disk — there is ~70GB free here against ~355GB of video.

Safe to stop and restart. Progress is recorded in R2 itself: a completed copy
gets a small "<key>.done" marker holding the verified byte count, so a restart
skips it. Nothing is marked done until the size in R2 matches what Cloudflare
said it was sending, because a truncated file that looks finished is worse
than one that is obviously missing.
"""
import argparse
import json
import os
import re
import subprocess
import sys
import threading
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import boto3
from botocore.config import Config as BotoConfig
from boto3.s3.transfer import TransferConfig

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV = os.path.join(ROOT, 'backend', '.env')

# Cloudflare's edge blocks Python's default user-agent signature with error
# 1010 — the token is fine, the client string is not. Any ordinary UA passes.
USER_AGENT = 'muzawatch-migrate/1.0'

# Fetched in ranged chunks rather than one long stream: two separate large
# files both stopped at ~181 MiB, which is a limit on a single connection, not
# packet loss. A part is one short-lived request, so a drop costs one part
# instead of a gigabyte, and each part is retried on its own.
PART_SIZE = 32 * 1024 * 1024

RENDITION_TIMEOUT = 45 * 60
RENDITION_POLL = 15
TOKEN_TTL = 6 * 3600

_lock = threading.Lock()


def log(msg):
    with _lock:
        print(f'{time.strftime("%H:%M:%S")} {msg}', flush=True)


def env():
    out = {}
    for k, v in re.findall(r'^(\w+)=(.*)$', open(ENV).read(), re.M):
        out[k] = v.strip().strip('"').strip("'")
    return out


def episodes():
    """Read-only list of ready Stream videos, straight from psql.

    Uses the running container rather than a Python database driver so this
    script adds no dependency to the project and cannot write anything.
    """
    sql = ("SELECT e.id, e.cf_video_uid, replace(coalesce(t.name,'episode'), '|', '-'), "
           "t.slug, t.kind, coalesce(e.season,1), coalesce(e.number,1), "
           "coalesce(e.duration_secs,0), t.id "
           "FROM episodes e JOIN titles t ON t.id = e.title_id "
           "WHERE e.cf_video_uid IS NOT NULL AND e.cf_status = 'ready' ORDER BY t.slug, e.season, e.number")
    out = subprocess.run(
        ['docker', 'exec', 'ugs_postgres', 'psql', '-U', 'ugstream_user', '-d', 'ugstream_db',
         '-t', '-A', '-F', '|', '-c', sql],
        capture_output=True, text=True, check=True).stdout
    rows = []
    for line in out.splitlines():
        p = [x.strip() for x in line.split('|')]
        if len(p) >= 9 and p[0]:
            rows.append({
                'episode_id': p[0], 'uid': p[1], 'title_name': p[2], 'slug': p[3],
                'kind': p[4], 'season': int(p[5] or 1), 'number': int(p[6] or 1),
                'duration_secs': int(p[7] or 0), 'title_id': p[8],
            })
    return rows


def key_for(row):
    """Where a video lives in R2.

    Grouped by title and named so the ordering is obvious in a listing, with
    the episode id kept in the filename: a transcoding pipeline can map any
    object back to the catalogue from its key alone, without a database.

        originals/your-honor/S01E03-ep267.mp4
        originals/big-buck-bunny/feature-ep1.mp4
    """
    stem = (f"S{row['season']:02d}E{row['number']:02d}" if row['kind'] == 'series' else 'feature')
    return f"originals/{row['slug']}/{stem}-ep{row['episode_id']}.mp4"


def cf_api(e, path, method='GET', body=None):
    url = f'https://api.cloudflare.com/client/v4/accounts/{e["CLOUDFLARE_ACCOUNT_ID"]}/stream{path}'
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={
        'Authorization': f'Bearer {e["CLOUDFLARE_STREAM_API_TOKEN"]}',
        'Content-Type': 'application/json',
    })
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)


def ensure_rendition(e, uid):
    waited = 0
    while True:
        res = cf_api(e, f'/{uid}/downloads', method='POST')
        if not res.get('success'):
            raise RuntimeError(f'downloads API refused: {res.get("errors")}')
        default = (res.get('result') or {}).get('default') or {}
        state = default.get('status')
        if state == 'ready':
            return
        if state == 'error':
            raise RuntimeError('Cloudflare could not build an MP4 for this video')
        if waited >= RENDITION_TIMEOUT:
            raise RuntimeError(f'rendition still {state} after {waited}s')
        time.sleep(RENDITION_POLL)
        waited += RENDITION_POLL


def download_url(e, uid):
    """These videos require signed URLs, and the download path only opens to
    a token minted with `downloadable` — a playback token is refused there."""
    res = cf_api(e, f'/{uid}/token', method='POST',
                 body={'exp': int(time.time()) + TOKEN_TTL, 'downloadable': True})
    if not res.get('success'):
        raise RuntimeError(f'token refused: {res.get("errors")}')
    return (f'https://customer-{e["CLOUDFLARE_CUSTOMER_CODE"]}.cloudflarestream.com/'
            f'{res["result"]["token"]}/downloads/default.mp4')


def r2_client(e):
    return boto3.client(
        's3',
        endpoint_url=f'https://{e["R2_ACCOUNT_ID"]}.r2.cloudflarestorage.com',
        aws_access_key_id=e['R2_ACCESS_KEY_ID'],
        aws_secret_access_key=e['R2_SECRET_ACCESS_KEY'],
        region_name='auto',
        # The default 60s read timeout is far too short here: a server-side
        # copy of a multi-gigabyte object holds the connection open for the
        # whole operation, and a multipart part upload can too.
        config=BotoConfig(read_timeout=900, connect_timeout=60,
                          retries={'max_attempts': 5, 'mode': 'standard'}),
    )


def head_size(client, bucket, key):
    try:
        return client.head_object(Bucket=bucket, Key=key)['ContentLength']
    except Exception:
        return None


def manifest_for(row, key, size):
    """Everything the transcoder needs, written beside the video.

    The pipeline should not have to reach into the platform's database to
    know what it is transcoding, and a sidecar travels with the file if the
    bucket is ever copied elsewhere.
    """
    return {
        'episodeId': row['episode_id'],
        'titleId': row['title_id'],
        'titleSlug': row['slug'],
        'titleName': row['title_name'],
        'kind': row['kind'],
        'season': row['season'],
        'episode': row['number'],
        'durationSecs': row['duration_secs'],
        'sourceStreamUid': row['uid'],
        'sourceObject': key,
        'sizeBytes': size,
        'copiedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        # Where the existing player expects self-hosted output to live, so a
        # pipeline that writes here needs no application change: set an
        # episode's videoProvider to 'r2_hls' and r2Prefix to this.
        'suggestedHlsPrefix': f"hls/ep-{row['episode_id']}/",
    }


def copy_one(e, row, dry_run=False):
    ep_id, uid, name = row['episode_id'], row['uid'], row['title_name']
    key = key_for(row)
    marker = f'{key}.done'
    client = r2_client(e)
    bucket = e['R2_BUCKET']

    # The marker is the record of a verified copy; the object alone is not,
    # because an interrupted upload leaves bytes behind too.
    if head_size(client, bucket, marker) is not None:
        return ('skipped', 0)

    if dry_run:
        log(f'[{ep_id}] would copy -> {key}')
        return ('skipped', 0)

    ensure_rendition(e, uid)
    url = download_url(e, uid)

    # Total size, learned from a one-byte ranged GET. HEAD is refused on this
    # endpoint, so Content-Range is the only way to ask.
    probe = urllib.request.Request(url, headers={'User-Agent': USER_AGENT, 'Range': 'bytes=0-0'})
    with urllib.request.urlopen(probe, timeout=120) as r:
        content_range = r.headers.get('Content-Range') or ''
    total = int(content_range.split('/')[-1]) if '/' in content_range else 0
    if not total:
        raise RuntimeError('could not determine size (no Content-Range)')

    log(f'[{ep_id}] {name[:38]:38s} {total/1e9:5.2f} GB -> {key}')

    mpu = client.create_multipart_upload(Bucket=bucket, Key=key)
    upload_id = mpu['UploadId']
    parts = []
    try:
        offset, part_no = 0, 1
        while offset < total:
            last_byte = min(offset + PART_SIZE, total) - 1
            want = last_byte - offset + 1
            chunk = None
            for attempt in range(1, 5):
                try:
                    req = urllib.request.Request(url, headers={
                        'User-Agent': USER_AGENT,
                        'Range': f'bytes={offset}-{last_byte}',
                    })
                    with urllib.request.urlopen(req, timeout=300) as r:
                        chunk = r.read()
                    if len(chunk) == want:
                        break
                    chunk = None  # short part: treat as a failure and retry
                except Exception:
                    chunk = None
                time.sleep(attempt * 5)
            if chunk is None:
                raise RuntimeError(f'could not fetch bytes {offset}-{last_byte}')

            res = client.upload_part(Bucket=bucket, Key=key, PartNumber=part_no,
                                     UploadId=upload_id, Body=chunk)
            parts.append({'ETag': res['ETag'], 'PartNumber': part_no})
            offset += want
            part_no += 1

        client.complete_multipart_upload(Bucket=bucket, Key=key, UploadId=upload_id,
                                         MultipartUpload={'Parts': parts})
    except Exception:
        # Leave no half-finished upload holding storage.
        try:
            client.abort_multipart_upload(Bucket=bucket, Key=key, UploadId=upload_id)
        except Exception:
            pass
        raise

    landed = head_size(client, bucket, key)
    if landed != total:
        client.delete_object(Bucket=bucket, Key=key)
        raise RuntimeError(f'size mismatch after assembly: {landed} vs {total}')

    client.put_object(
        Bucket=bucket, Key=f'{key[:-4]}.json',
        Body=json.dumps(manifest_for(row, key, landed), indent=2).encode(),
        ContentType='application/json',
    )
    client.put_object(Bucket=bucket, Key=marker, Body=str(landed).encode())
    return ('copied', landed)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--workers', type=int, default=2)
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    e = env()
    rows = episodes()
    if args.limit:
        rows = rows[:args.limit]
    log(f'{len(rows)} ready Stream video(s) in scope')

    tally = {'copied': 0, 'skipped': 0, 'failed': 0, 'bytes': 0}

    def work(row):
        try:
            status, size = copy_one(e, row, args.dry_run)
            with _lock:
                tally[status] += 1
                tally['bytes'] += size
        except Exception as ex:
            log(f"[{row['episode_id']}] FAILED: {ex}")
            with _lock:
                tally['failed'] += 1

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        list(pool.map(work, rows))

    log(f'copied={tally["copied"]} skipped={tally["skipped"]} '
        f'failed={tally["failed"]} moved={tally["bytes"]/1e9:.1f} GB')
    return 1 if tally['failed'] else 0


if __name__ == '__main__':
    sys.exit(main())
