import { TranscodeService } from './transcode.service';

/**
 * Covers the two ways a self-hosted transcode used to strand an episode on
 * 'uploading' with nothing able to clear it:
 *
 *  - publishing a season started one ffmpeg per episode at the same time,
 *    each encoding four rungs up to 2160p, which buries the box; and
 *  - a job lives only in this process, so a restart mid-encode lost it
 *    without ever recording the failure.
 *
 * syncStatus cannot help either case — it returns early on a row with no
 * cfVideoUid, which a self-hosted episode never has.
 */
describe('TranscodeService', () => {
  const makeService = () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 0 });
    const update = jest.fn().mockResolvedValue({});
    const prisma = { episode: { updateMany, update } };
    const service = new TranscodeService(prisma as any, {} as any);
    return { service, prisma, updateMany, update };
  };

  /** Replaces the real ffmpeg pipeline with a controllable stub. */
  function stubRun(service: TranscodeService) {
    const started: bigint[] = [];
    const finished: bigint[] = [];
    const gates = new Map<string, () => void>();
    (service as any).runTranscode = (episodeId: bigint) => {
      started.push(episodeId);
      return new Promise<void>((resolve) => {
        gates.set(episodeId.toString(), () => {
          finished.push(episodeId);
          resolve();
        });
      });
    };
    return { started, finished, release: (id: bigint) => gates.get(id.toString())!() };
  }

  const settle = () => new Promise((r) => setImmediate(r));

  describe('queueing', () => {
    it('runs one transcode at a time instead of all of them at once', async () => {
      const { service } = makeService();
      const jobs = stubRun(service);

      for (const id of [1n, 2n, 3n]) service.startTranscode(id, `https://src/${id}.mkv`);
      await settle();

      // A whole season queued, but only the first episode is encoding.
      expect(jobs.started).toEqual([1n]);

      jobs.release(1n);
      await settle();
      expect(jobs.started).toEqual([1n, 2n]);

      jobs.release(2n);
      await settle();
      expect(jobs.started).toEqual([1n, 2n, 3n]);

      jobs.release(3n);
      await settle();
      expect(jobs.finished).toEqual([1n, 2n, 3n]);
    });

    it('a failing job marks its own episode and does not stall the queue', async () => {
      const { service, update } = makeService();
      const started: bigint[] = [];
      (service as any).runTranscode = (episodeId: bigint) => {
        started.push(episodeId);
        return episodeId === 1n ? Promise.reject(new Error('ffmpeg exited 1')) : Promise.resolve();
      };

      service.startTranscode(1n, 'https://src/1.mkv');
      service.startTranscode(2n, 'https://src/2.mkv');
      await settle();
      await settle();

      expect(update).toHaveBeenCalledWith({ where: { id: 1n }, data: { cfStatus: 'error' } });
      expect(started).toEqual([1n, 2n]); // the good episode still ran
    });

    it('a job queued while the drain is winding down is still picked up', async () => {
      const { service } = makeService();
      const jobs = stubRun(service);

      service.startTranscode(1n, 'https://src/1.mkv');
      await settle();
      jobs.release(1n);
      service.startTranscode(2n, 'https://src/2.mkv');
      await settle();

      expect(jobs.started).toEqual([1n, 2n]);
    });
  });

  describe('recovery at startup', () => {
    it("marks transcodes still 'uploading' at boot as failed — their process is gone", async () => {
      const { service, updateMany } = makeService();
      updateMany.mockResolvedValue({ count: 3 });

      await service.onModuleInit();

      expect(updateMany).toHaveBeenCalledWith({
        where: { videoProvider: 'r2_hls', cfStatus: 'uploading' },
        data: { cfStatus: 'error' },
      });
    });

    it('leaves ready and pending rows alone, and survives a database that is down', async () => {
      const { service, updateMany } = makeService();
      updateMany.mockRejectedValue(new Error('db down'));

      // Boot must not be blocked by the reclaim failing.
      await expect(service.onModuleInit()).resolves.toBeUndefined();
    });
  });
});
