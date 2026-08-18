import { EpisodesService } from './episodes.service';

/**
 * The Continue Watching rail is a catalogue read, but it lives in
 * episodes.service.ts rather than titles.service.ts — so the source-scan guard
 * in titles/audience.spec.ts never covered it, and for a while it filtered on
 * nothing but the user id.
 *
 * The effect was invisible until content moved: watch history outlives the
 * catalogue, so an unpublished title (or one moved between the live and test
 * audiences) kept rendering as a tile, and play() — which does enforce the
 * audience — then refused it. A dead tile on the home screen. It was found on
 * the account handed to App Review, still showing an unpublished 4K demo.
 *
 * These assert on the query the rail builds, since that is where the bug was.
 */
describe('continue watching applies the audience filter', () => {
  function serviceFor(viewer: { isTester?: boolean; canPreviewAll?: boolean }) {
    const calls: any[] = [];
    const prisma = {
      user: { findUnique: async () => viewer },
      watchHistory: {
        findMany: async (args: any) => {
          calls.push(args);
          return [];
        },
      },
    };
    const service = new EpisodesService(
      prisma as any,
      {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
    );
    return { service, calls };
  }

  it('an ordinary viewer only sees published titles', async () => {
    const { service, calls } = serviceFor({ isTester: false });
    await service.continueWatching(1n);

    expect(calls[0].where.episode.title).toEqual({ published: true });
  });

  it('a tester only sees test titles — never the live catalogue', async () => {
    const { service, calls } = serviceFor({ isTester: true });
    await service.continueWatching(61n);

    expect(calls[0].where.episode.title).toEqual({ isTest: true });
  });

  it('a previewer sees everything, as the wider grant intends', async () => {
    const { service, calls } = serviceFor({ isTester: true, canPreviewAll: true });
    await service.continueWatching(5n);

    expect(calls[0].where.episode.title).toEqual({});
  });

  it('still scopes to the user and to unfinished episodes', async () => {
    const { service, calls } = serviceFor({ isTester: false });
    await service.continueWatching(7n);

    expect(calls[0].where.userId).toBe(7n);
    expect(calls[0].where.completed).toBe(false);
  });
});
