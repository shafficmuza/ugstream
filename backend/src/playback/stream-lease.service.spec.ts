import { HttpException } from '@nestjs/common';
import { StreamLeaseService } from './stream-lease.service';

/**
 * Concurrent-stream limiting. Prisma is mocked so the branching is tested
 * deterministically — in particular the two cases that decide whether the
 * feature is usable or infuriating: a session must never be blocked by its
 * own lease, and a lease with no recent heartbeat must not hold a slot.
 */
function makeService(opts: { maxStreams?: number; activeOthers?: number } = {}) {
  const count = jest.fn().mockResolvedValue(opts.activeOthers ?? 0);
  const upsert = jest.fn().mockResolvedValue({});
  const updateMany = jest.fn().mockResolvedValue({ count: 1 });
  const findMany = jest.fn().mockResolvedValue([]);

  const prisma: any = {
    appSettings: {
      findUnique: jest.fn().mockResolvedValue({ maxStreams: opts.maxStreams ?? 2 }),
    },
    streamLease: { count, upsert, updateMany, findMany },
  };
  return { service: new StreamLeaseService(prisma), count, upsert, updateMany };
}

describe('StreamLeaseService.acquire', () => {
  it('allows playback when the account is below its limit', async () => {
    const { service, upsert } = makeService({ maxStreams: 2, activeOthers: 1 });
    await expect(service.acquire(1n, 'sess-a', 10n)).resolves.toBeUndefined();
    expect(upsert).toHaveBeenCalled();
  });

  it('rejects with 409 once the limit is reached', async () => {
    const { service, upsert } = makeService({ maxStreams: 2, activeOthers: 2 });
    await expect(service.acquire(1n, 'sess-a', 10n)).rejects.toBeInstanceOf(HttpException);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('reports the limit in the error so the client can explain it', async () => {
    const { service } = makeService({ maxStreams: 2, activeOthers: 2 });
    await expect(service.acquire(1n, 'sess-a', 10n)).rejects.toMatchObject({
      response: { error: 'StreamLimitReached', limit: 2 },
    });
  });

  it('phrases the single-stream case in the singular', async () => {
    const { service } = makeService({ maxStreams: 1, activeOthers: 1 });
    await expect(service.acquire(1n, 'sess-a', 10n)).rejects.toMatchObject({
      response: { message: expect.stringContaining('another device') },
    });
  });

  it('never counts the requesting session against itself', async () => {
    // Re-opening the player on the same device must not consume a second
    // slot, or seeking and reloading would lock a user out of their own
    // stream — the failure this excludes is subtle and very hard to
    // reproduce by hand once it ships.
    const { service, count } = makeService({ maxStreams: 1, activeOthers: 0 });
    await service.acquire(1n, 'sess-a', 10n);
    expect(count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ sessionId: { not: 'sess-a' } }),
      }),
    );
  });

  it('ignores leases with no recent heartbeat', async () => {
    const { service, count } = makeService({ maxStreams: 1 });
    await service.acquire(1n, 'sess-a', 10n);
    const where = count.mock.calls[0][0].where;
    expect(where.lastSeenAt.gt).toBeInstanceOf(Date);
    // The cutoff must be in the past; a future one would count nothing and
    // silently disable the limit altogether.
    expect(where.lastSeenAt.gt.getTime()).toBeLessThan(Date.now());
    expect(where.endedAt).toBeNull();
  });

  it('treats a limit of 0 as unlimited and does not even query', async () => {
    const { service, count, upsert } = makeService({ maxStreams: 0 });
    await expect(service.acquire(1n, 'sess-a', 10n)).resolves.toBeUndefined();
    expect(count).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });
});

describe('StreamLeaseService.touch', () => {
  it('never throws — a failed heartbeat must not interrupt playback', async () => {
    const prisma: any = {
      appSettings: { findUnique: jest.fn() },
      streamLease: { updateMany: jest.fn().mockRejectedValue(new Error('db down')) },
    };
    const service = new StreamLeaseService(prisma);
    await expect(service.touch('sess-a', 10n)).resolves.toBeUndefined();
  });
});

describe('StreamLeaseService.release', () => {
  it('ends only the calling session’s live lease', async () => {
    const { service, updateMany } = makeService();
    await service.release('sess-a');
    expect(updateMany).toHaveBeenCalledWith({
      where: { sessionId: 'sess-a', endedAt: null },
      data: { endedAt: expect.any(Date) },
    });
  });

  it('never throws — the lease expires on its own if this fails', async () => {
    const prisma: any = {
      appSettings: { findUnique: jest.fn() },
      streamLease: { updateMany: jest.fn().mockRejectedValue(new Error('db down')) },
    };
    await expect(new StreamLeaseService(prisma).release('sess-a')).resolves.toBeUndefined();
  });
});
