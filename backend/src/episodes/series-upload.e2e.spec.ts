import { EpisodesService } from './episodes.service';

/**
 * End-to-end walk of the series upload lifecycle against a stateful
 * in-memory Prisma + Cloudflare. Written after 2026-08-08, when nine
 * episodes (The Asset ×6, A House of Dynamite ×2, The Copenhagen Test)
 * were found stuck on 'uploading' forever: "+ Add episode" eagerly created
 * a Cloudflare placeholder and marked the row uploading before any bytes
 * moved, and nothing ever reclaimed the slot when the browser upload died.
 *
 * The flow exercised here is the real one the admin UI drives:
 *   create slot → request tus upload → (upload dies | completes) →
 *   admin reopens page (syncStatus) / webhook (markReady) → ready | pending
 */

// ---------------------------------------------------------------------------
// Stateful fakes
// ---------------------------------------------------------------------------

type EpisodeRow = {
  id: bigint;
  titleId: bigint;
  season: number;
  number: number;
  name: string | null;
  videoProvider: string;
  cfVideoUid: string | null;
  cfStatus: string;
  durationSecs: number | null;
  thumbnailUrl: string | null;
  r2Prefix: string | null;
};

class FakeEpisodeDb {
  rows: EpisodeRow[] = [];
  private nextId = 1n;

  private matches(row: EpisodeRow, where: any): boolean {
    for (const [k, v] of Object.entries(where ?? {})) {
      if ((row as any)[k] !== v) return false;
    }
    return true;
  }

  episode = {
    create: async ({ data }: any) => {
      const row: EpisodeRow = {
        id: this.nextId++,
        titleId: data.titleId,
        season: data.season ?? 1,
        number: data.number ?? 1,
        name: data.name ?? null,
        videoProvider: data.videoProvider ?? 'cloudflare',
        cfVideoUid: data.cfVideoUid ?? null,
        cfStatus: data.cfStatus ?? 'pending',
        durationSecs: data.durationSecs ?? null,
        thumbnailUrl: data.thumbnailUrl ?? null,
        r2Prefix: data.r2Prefix ?? null,
      };
      this.rows.push(row);
      return { ...row };
    },
    findFirst: async ({ where, orderBy }: any) => {
      let found = this.rows.filter((r) => this.matches(r, where));
      if (orderBy?.number === 'desc') found = found.sort((a, b) => b.number - a.number);
      return found[0] ? { ...found[0] } : null;
    },
    findUnique: async ({ where }: any) => {
      const r = this.rows.find((x) => x.id === where.id);
      return r ? { ...r } : null;
    },
    findUniqueOrThrow: async ({ where }: any) => {
      const r = this.rows.find((x) => x.id === where.id);
      if (!r) throw new Error(`episode ${where.id} not found`);
      return { ...r };
    },
    findMany: async () => this.rows.map((r) => ({ ...r })),
    update: async ({ where, data }: any) => {
      const r = this.rows.find((x) => x.id === where.id);
      if (!r) throw new Error(`episode ${where.id} not found`);
      Object.assign(r, data);
      return { ...r };
    },
    updateMany: async ({ where, data }: any) => {
      for (const r of this.rows.filter((x) => this.matches(x, where))) Object.assign(r, data);
      return {};
    },
  };
}

/** Cloudflare Stream, reduced to the state machine the service cares about. */
class FakeCloudflare {
  videos = new Map<string, { state: string; createdAt: Date; durationSecs: number }>();
  private seq = 0;

  createDirectUpload = jest.fn(async () => {
    const uid = `direct-${++this.seq}`;
    this.videos.set(uid, { state: 'pendingupload', createdAt: new Date(), durationSecs: 0 });
    return { uploadUrl: `https://upload.example/${uid}`, videoUid: uid };
  });

  createTusUpload = jest.fn(async (_len: number, _name: string) => {
    const uid = `tus-${++this.seq}`;
    this.videos.set(uid, { state: 'pendingupload', createdAt: new Date(), durationSecs: 0 });
    return { uploadUrl: `https://upload.example/tus/${uid}`, videoUid: uid };
  });

  copyFromUrl = jest.fn(async () => {
    const uid = `copy-${++this.seq}`;
    this.videos.set(uid, { state: 'downloading', createdAt: new Date(), durationSecs: 0 });
    return { videoUid: uid };
  });

  deleteVideo = jest.fn(async (uid: string) => {
    this.videos.delete(uid); // 404s are swallowed in the real service too
  });

  listVideos = jest.fn(async () =>
    [...this.videos.entries()].map(([uid, v]) => ({ uid, state: v.state })),
  );

  getVideoStatus = jest.fn(async (uid: string) => {
    const v = this.videos.get(uid);
    if (!v) {
      return {
        ready: false, errored: false, missing: true, state: 'missing',
        createdAt: null, durationSecs: 0, thumbnailUrl: '',
      };
    }
    return {
      ready: v.state === 'ready',
      errored: v.state === 'error',
      missing: false,
      state: v.state,
      createdAt: v.createdAt,
      durationSecs: v.durationSecs,
      thumbnailUrl: v.state === 'ready' ? `https://thumbs.example/${uid}.jpg` : '',
    };
  });

  // Test helpers: what Cloudflare's side does out-of-band.
  finishEncoding(uid: string, durationSecs: number) {
    this.videos.set(uid, { state: 'ready', createdAt: new Date(), durationSecs });
  }
  ageOut(uid: string, hours: number) {
    const v = this.videos.get(uid)!;
    v.createdAt = new Date(Date.now() - hours * 3600 * 1000);
  }
}

function makeService() {
  const db = new FakeEpisodeDb();
  const cf = new FakeCloudflare();
  const r2 = {
    configured: true,
    publicUrl: (key: string) => `https://cdn.example/${key}`,
    exists: jest.fn().mockResolvedValue(true),
  };
  const transcode = { startTranscode: jest.fn() };
  const service = new EpisodesService(
    db as any,
    { check: jest.fn().mockResolvedValue({ entitled: true, reason: 'staff' }) } as any, // entitlements
    cf as any,
    r2 as any,
    transcode as any,
    { touch: jest.fn(), acquire: jest.fn() } as any, // leases
    { get: jest.fn() } as any, // config
  );
  return { service, db, cf, r2, transcode };
}

const TITLE = 133n;

// ---------------------------------------------------------------------------

describe('series upload flow (end to end)', () => {
  it('creating an episode slot makes NO Cloudflare video and the row is pending, not uploading', async () => {
    const { service, cf } = makeService();

    const { episode } = await service.createForTitle(TITLE, { season: 1, number: 1, name: 'Part 1' });

    expect(episode.cfStatus).toBe('pending');
    expect(episode.cfVideoUid).toBeNull();
    expect((episode as any).uploadUrl).toBeUndefined();
    expect(cf.createDirectUpload).not.toHaveBeenCalled();
    expect(cf.createTusUpload).not.toHaveBeenCalled();
    expect(cf.videos.size).toBe(0); // the 2026-08-08 orphan bug: this was 1
  });

  it('season/number sequencing: explicit slots stick, omitted numbers auto-increment, clashes 409', async () => {
    const { service } = makeService();

    await service.createForTitle(TITLE, { season: 1, number: 1 });
    const e2 = await service.createForTitle(TITLE, { season: 1 }); // no number → next free
    expect(e2.episode.number).toBe(2);

    await expect(service.createForTitle(TITLE, { season: 1, number: 2 })).rejects.toThrow(/already exists/);
  });

  it('happy path: slot → tus upload → Cloudflare finishes → webhook marks ready', async () => {
    const { service, db, cf } = makeService();
    const { episode } = await service.createForTitle(TITLE, { season: 1, number: 1 });

    const { uploadUrl } = await service.getTusUploadUrl(BigInt(episode.id), 2_000_000_000, 'part1.mkv');
    expect(uploadUrl).toContain('tus');
    let row = db.rows[0];
    expect(row.cfStatus).toBe('uploading');
    expect(row.cfVideoUid).toBeTruthy();

    // Browser uploads all chunks; Cloudflare encodes; the webhook fires.
    cf.finishEncoding(row.cfVideoUid!, 2598);
    await service.markReady(row.cfVideoUid!, 2598, 'https://thumbs.example/x.jpg');

    row = db.rows[0];
    expect(row.cfStatus).toBe('ready');
    expect(row.durationSecs).toBe(2598);
  });

  it('missed webhook: syncStatus flips a finished video to ready on the read path', async () => {
    const { service, db, cf } = makeService();
    const { episode } = await service.createForTitle(TITLE, { season: 1, number: 1 });
    await service.getTusUploadUrl(BigInt(episode.id), 1_000, 'p.mkv');
    cf.finishEncoding(db.rows[0].cfVideoUid!, 1234);

    const synced = await service.syncStatus(await (db.episode.findUnique({ where: { id: db.rows[0].id } }) as any));

    expect(synced.cfStatus).toBe('ready');
    expect(synced.durationSecs).toBe(1234);
  });

  it('re-requesting a tus URL deletes the superseded placeholder (no orphans)', async () => {
    const { service, db, cf } = makeService();
    const { episode } = await service.createForTitle(TITLE, { season: 1, number: 1 });

    await service.getTusUploadUrl(BigInt(episode.id), 1_000, 'a.mkv');
    const firstUid = db.rows[0].cfVideoUid!;
    await service.getTusUploadUrl(BigInt(episode.id), 1_000, 'a.mkv'); // admin re-picks the file

    expect(cf.videos.has(firstUid)).toBe(false);
    expect(cf.videos.size).toBe(1);
    expect(db.rows[0].cfVideoUid).not.toBe(firstUid);
  });

  it('dead upload (>24h with zero bytes) is reclaimed by syncStatus: video deleted, row back to pending', async () => {
    const { service, db, cf } = makeService();
    const { episode } = await service.createForTitle(TITLE, { season: 1, number: 1 });
    await service.getTusUploadUrl(BigInt(episode.id), 1_000, 'died.mkv');
    const uid = db.rows[0].cfVideoUid!;
    cf.ageOut(uid, 25);

    const synced = await service.syncStatus(await (db.episode.findUnique({ where: { id: db.rows[0].id } }) as any));

    expect(synced.cfStatus).toBe('pending');
    expect(synced.cfVideoUid).toBeNull();
    expect(cf.videos.has(uid)).toBe(false);
  });

  it('a young in-flight upload is NOT reclaimed', async () => {
    const { service, db, cf } = makeService();
    const { episode } = await service.createForTitle(TITLE, { season: 1, number: 1 });
    await service.getTusUploadUrl(BigInt(episode.id), 1_000, 'slow.mkv');
    cf.ageOut(db.rows[0].cfVideoUid!, 3); // 3h in, still moving

    const synced = await service.syncStatus(await (db.episode.findUnique({ where: { id: db.rows[0].id } }) as any));

    expect(synced.cfStatus).toBe('uploading');
    expect(synced.cfVideoUid).toBeTruthy();
  });

  it('vanished video (expired placeholder / deleted on Cloudflare) is reclaimed immediately', async () => {
    const { service, db, cf } = makeService();
    const { episode } = await service.createForTitle(TITLE, { season: 1, number: 1 });
    await service.getTusUploadUrl(BigInt(episode.id), 1_000, 'gone.mkv');
    cf.videos.delete(db.rows[0].cfVideoUid!); // Cloudflare purged it

    const synced = await service.syncStatus(await (db.episode.findUnique({ where: { id: db.rows[0].id } }) as any));

    expect(synced.cfStatus).toBe('pending');
    expect(synced.cfVideoUid).toBeNull();
  });

  it('cancel-upload resets a stuck row and deletes the Cloudflare video', async () => {
    const { service, db, cf } = makeService();
    const { episode } = await service.createForTitle(TITLE, { season: 1, number: 1 });
    await service.getTusUploadUrl(BigInt(episode.id), 1_000, 'stuck.mkv');
    const uid = db.rows[0].cfVideoUid!;

    const r = await service.cancelUpload(BigInt(episode.id));

    expect(r.cfStatus).toBe('pending');
    expect(r.cfVideoUid).toBeNull();
    expect(cf.videos.has(uid)).toBe(false);
  });

  it('cancel-upload refuses to touch a ready episode', async () => {
    const { service, db } = makeService();
    const { episode } = await service.createForTitle(TITLE, { season: 1, number: 1 });
    await service.getTusUploadUrl(BigInt(episode.id), 1_000, 'done.mkv');
    await service.markReady(db.rows[0].cfVideoUid!, 100, '');

    await expect(service.cancelUpload(BigInt(episode.id))).rejects.toThrow(/already ready/);
  });

  it('after a failed upload the admin can retry into the same slot end to end', async () => {
    const { service, db, cf } = makeService();
    const { episode } = await service.createForTitle(TITLE, { season: 1, number: 3 });
    const id = BigInt(episode.id);

    // Attempt 1 dies in the browser; the UI calls cancel-upload.
    await service.getTusUploadUrl(id, 1_000, 'attempt1.mkv');
    await service.cancelUpload(id);
    expect(db.rows[0].cfStatus).toBe('pending');

    // Attempt 2 succeeds.
    await service.getTusUploadUrl(id, 1_000, 'attempt2.mkv');
    cf.finishEncoding(db.rows[0].cfVideoUid!, 777);
    await service.markReady(db.rows[0].cfVideoUid!, 777, '');

    expect(db.rows[0].cfStatus).toBe('ready');
    expect(db.rows[0].season).toBe(1);
    expect(db.rows[0].number).toBe(3); // same slot, no duplicate rows
    expect(db.rows).toHaveLength(1);
    expect(cf.videos.size).toBe(1); // no leftovers
  });

  it('import-url FILLS an empty slot the admin created in advance', async () => {
    // The bug that made series unimportable: an admin lays out S1E1..E6 with
    // "+ Add episode", then every server-side import answers 409 because the
    // empty row looks like a clash — leaving only a multi-gigabyte browser
    // upload as a route in.
    const { service, db, cf } = makeService();
    const { episode } = await service.createForTitle(TITLE, { season: 1, number: 1 });
    expect(db.rows).toHaveLength(1);

    const ep = await service.importFromUrl(TITLE, 'https://media.example/e1.mkv', 'E1', {
      season: 1,
      number: 1,
    });

    expect(ep.id).toBe(episode.id); // same row, not a duplicate
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0].cfStatus).toBe('uploading');
    expect(db.rows[0].cfVideoUid).toBeTruthy();
    expect(cf.copyFromUrl).toHaveBeenCalledTimes(1);
  });

  it('import-url still refuses a slot that already holds a video', async () => {
    const { service, db, cf } = makeService();
    const { episode } = await service.createForTitle(TITLE, { season: 1, number: 1 });
    await service.getTusUploadUrl(BigInt(episode.id), 1_000, 'a.mkv');
    await service.markReady(db.rows[0].cfVideoUid!, 100, '');

    await expect(
      service.importFromUrl(TITLE, 'https://media.example/e1.mkv', 'E1', { season: 1, number: 1 }),
    ).rejects.toThrow(/already has a video/);
    expect(cf.copyFromUrl).not.toHaveBeenCalled(); // checked BEFORE ingest
  });

  it('filling empty slots across a whole season leaves one row per episode', async () => {
    const { service, db } = makeService();
    for (let n = 1; n <= 6; n++) await service.createForTitle(TITLE, { season: 1, number: n });
    for (let n = 1; n <= 6; n++) {
      await service.importFromUrl(TITLE, `https://media.example/e${n}.mkv`, `E${n}`, {
        season: 1,
        number: n,
      });
    }
    expect(db.rows).toHaveLength(6);
    expect(db.rows.map((r) => r.number).sort()).toEqual([1, 2, 3, 4, 5, 6]);
    expect(db.rows.every((r) => r.cfStatus === 'uploading' && r.cfVideoUid)).toBe(true);
  });

  it('import-url takes the season and number it is given', async () => {
    const { service, cf } = makeService();

    const ep = await service.importFromUrl(TITLE, 'https://media.example/f.mkv', 'f.mkv', {
      season: 2,
      number: 4,
    });

    expect([ep.season, ep.number]).toEqual([2, 4]);
    expect(ep.cfStatus).toBe('uploading');
    expect(cf.copyFromUrl).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // Every ingest path, not just the URL import.
  //
  // Filling a pre-created slot was originally fixed for importFromUrl alone,
  // leaving the three R2 routes the admin UI actually offers for series
  // ("Ready 4K file", "Transcode", "Ladder") still answering 409 on the very
  // workflow the fix was written for: lay out S1E1..E6, then upload into each.
  // -------------------------------------------------------------------------

  describe('filling a slot the admin created in advance', () => {
    /** Drives one ingest path into season 1 episode 1 of TITLE. */
    const paths: [string, (s: EpisodesService) => Promise<any>][] = [
      ['register-r2-file', (s) => s.registerR2File(TITLE, 'files/x.mp4', { season: 1, number: 1 })],
      ['transcode-4k-r2', (s) => s.transcode4kFromR2(TITLE, 'sources/x.mkv', { season: 1, number: 1 })],
      ['register-r2-hls', (s) => s.registerR2Hls(TITLE, 'hls/pre-abc/', { season: 1, number: 1 })],
      ['transcode-4k (url)', (s) => s.transcode4k(TITLE, 'https://media.example/x.mkv', { season: 1, number: 1 })],
    ];

    beforeEach(() => {
      // registerR2Hls probes the uploaded master playlist for its duration.
      global.fetch = jest.fn().mockResolvedValue({
        text: async () => '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nv0.m3u8\n#EXTINF:6.0,\ns0.ts\n',
      }) as any;
    });

    it.each(paths)('%s fills the empty slot instead of 409ing', async (_name, run) => {
      const { service, db } = makeService();
      const { episode } = await service.createForTitle(TITLE, { season: 1, number: 1, name: 'Pilot' });

      const ep = await run(service);

      expect(ep.id).toBe(episode.id); // same row, not a duplicate
      expect(db.rows).toHaveLength(1);
      expect(db.rows[0].name).toBe('Pilot'); // an unnamed upload keeps the slot's label
    });

    it.each(paths)('%s still refuses a slot that already holds a video', async (_name, run) => {
      const { service, db } = makeService();
      const { episode } = await service.createForTitle(TITLE, { season: 1, number: 1 });
      await service.getTusUploadUrl(BigInt(episode.id), 1_000, 'a.mkv');
      await service.markReady(db.rows[0].cfVideoUid!, 100, '');

      await expect(run(service)).rejects.toThrow(/already has a video/);
      expect(db.rows).toHaveLength(1);
    });

    it('a whole season laid out in advance takes one upload each, one row each', async () => {
      const { service, db } = makeService();
      for (let n = 1; n <= 6; n++) await service.createForTitle(TITLE, { season: 1, number: n });

      for (let n = 1; n <= 6; n++) {
        await service.registerR2File(TITLE, `files/e${n}.mp4`, { season: 1, number: n });
      }

      expect(db.rows).toHaveLength(6);
      expect(db.rows.map((r) => r.number).sort()).toEqual([1, 2, 3, 4, 5, 6]);
      expect(db.rows.every((r) => r.cfStatus === 'ready' && r.r2Prefix)).toBe(true);
    });

    it('a dead self-hosted transcode can be reset and retried', async () => {
      // The stuck-on-processing dead end: a transcode killed by a restart is
      // marked 'error' at boot, but cancel-upload used to refuse anything
      // that was not Cloudflare, so the row could never be cleared and the
      // slot was lost for good.
      const { service, db } = makeService();
      await service.transcode4kFromR2(TITLE, 'sources/x.mkv', { season: 1, number: 1 });
      db.rows[0].cfStatus = 'error'; // what onModuleInit does after a restart

      const reset = await service.cancelUpload(db.rows[0].id);

      expect(reset.cfStatus).toBe('pending');
      expect(reset.r2Prefix).toBeNull(); // else claimSlot reads it as holding a video
      expect(reset.videoProvider).toBe('cloudflare'); // a clean slot again

      // And the slot genuinely accepts a fresh upload.
      const retried = await service.registerR2File(TITLE, 'files/x.mp4', { season: 1, number: 1 });
      expect(retried.id).toBe(reset.id);
      expect(db.rows).toHaveLength(1);
      expect(db.rows[0].cfStatus).toBe('ready');
    });

    it('an upload that carries its own name overwrites the slot label', async () => {
      const { service, db } = makeService();
      await service.createForTitle(TITLE, { season: 1, number: 1, name: 'Placeholder' });

      await service.registerR2File(TITLE, 'files/x.mp4', { season: 1, number: 1, name: 'The Reckoning' });

      expect(db.rows[0].name).toBe('The Reckoning');
    });
  });
});
