import { audienceWhere, audienceSql, mayViewTitle, isTestViewer } from './audience';
import { readCatalogueMode } from './catalogue-mode';
import { TitlesService } from './titles.service';

/**
 * Two modes, and the rule that matters in each.
 *
 * In test mode the site IS the test catalogue: everyone gets it, anonymous
 * visitors included, and only an Early access account can reach the published
 * one. That last part is the whole point — a title published while the
 * platform is held back (THE GET OUT, 2026-08-20) must not appear on the
 * homepage to someone who has never signed in.
 *
 * In live mode the arrangement is the ordinary one for after launch.
 */
describe('audienceWhere', () => {
  describe('test mode — the site is the test catalogue', () => {
    it('gives an anonymous visitor the TEST catalogue, never the published one', () => {
      expect(audienceWhere(undefined, 'test')).toEqual({ isTest: true });
      expect(audienceWhere(null, 'test')).toEqual({ isTest: true });
    });

    it('gives an ordinary signed-in account the test catalogue', () => {
      expect(audienceWhere({ isTester: false }, 'test')).toEqual({ isTest: true });
      expect(audienceWhere({} as any, 'test')).toEqual({ isTest: true });
    });

    it('gives a tester account the test catalogue', () => {
      expect(audienceWhere({ isTester: true }, 'test')).toEqual({ isTest: true });
    });

    it('gives ONLY Early access the published catalogue', () => {
      // The stated rule: everyone sees test content; the published titles
      // being held back are reachable by Early access accounts alone.
      expect(audienceWhere({ canPreviewAll: true }, 'test')).toEqual({});

      for (const viewer of [undefined, null, {}, { isTester: false }, { isTester: true }]) {
        expect(audienceWhere(viewer as any, 'test')).toEqual({ isTest: true });
      }
    });
  });

  describe('live mode — the arrangement after launch', () => {
    it('gives an anonymous visitor and an ordinary account the published catalogue', () => {
      expect(audienceWhere(undefined, 'live')).toEqual({ published: true });
      expect(audienceWhere({ isTester: false }, 'live')).toEqual({ published: true });
    });

    it('gives a tester the test catalogue and NOT the live one', () => {
      const where = audienceWhere({ isTester: true }, 'live');
      expect(where).toEqual({ isTest: true });
      expect(where).not.toHaveProperty('published');
    });

    it('treats a missing flag as an ordinary viewer', () => {
      expect(audienceWhere({} as any, 'live')).toEqual({ published: true });
      expect(isTestViewer({} as any)).toBe(false);
    });
  });

  it('early access beats every other flag, in either mode', () => {
    // The wider grant wins. Otherwise flagging someone for early access would
    // silently do nothing, the opposite of what the admin just asked for.
    for (const mode of ['test', 'live'] as const) {
      expect(audienceWhere({ isTester: true, canPreviewAll: true }, mode)).toEqual({});
      expect(audienceWhere({ isTester: false, canPreviewAll: true }, mode)).toEqual({});
    }
  });

  it('early access off leaves the mode rules untouched', () => {
    expect(audienceWhere({ canPreviewAll: false }, 'test')).toEqual({ isTest: true });
    expect(audienceWhere({ canPreviewAll: false }, 'live')).toEqual({ published: true });
  });

  it('never returns a clause that would match both catalogues', () => {
    for (const mode of ['test', 'live'] as const) {
      for (const viewer of [undefined, null, { isTester: false }, { isTester: true }]) {
        expect(Object.keys(audienceWhere(viewer as any, mode)).length).toBeLessThanOrEqual(1);
      }
    }
  });
});

/**
 * The SQL and the playback check must say the same thing as the Prisma clause.
 * They are three spellings of one rule, and a rail that disagrees with the
 * guard is exactly how a held-back title reaches a homepage.
 */
describe('the three spellings of the rule agree', () => {
  const viewers = [undefined, null, {}, { isTester: true }, { isTester: false }, { canPreviewAll: true }];

  it('audienceSql matches audienceWhere for every viewer and mode', () => {
    for (const mode of ['test', 'live'] as const) {
      for (const v of viewers) {
        const where = audienceWhere(v as any, mode);
        const sql = audienceSql(v as any, mode);
        if (Object.keys(where).length === 0) expect(sql).toBe('TRUE');
        else if ('isTest' in where) expect(sql).toBe('t.is_test = true');
        else expect(sql).toBe('t.published = true');
      }
    }
  });

  it('mayViewTitle matches audienceWhere for every viewer and mode', () => {
    const titles = [
      { isTest: true, published: false },
      { isTest: false, published: true },
      { isTest: false, published: false },
      { isTest: true, published: true },
    ];
    for (const mode of ['test', 'live'] as const) {
      for (const v of viewers) {
        const where = audienceWhere(v as any, mode);
        for (const t of titles) {
          const expected =
            Object.keys(where).length === 0 ? true : 'isTest' in where ? t.isTest : t.published;
          expect(mayViewTitle(v as any, t, mode)).toBe(expected);
        }
      }
    }
  });

  it('a published, non-test title is unplayable by everyone but Early access in test mode', () => {
    const getOut = { isTest: false, published: true };
    expect(mayViewTitle(undefined, getOut, 'test')).toBe(false);
    expect(mayViewTitle({ isTester: false }, getOut, 'test')).toBe(false);
    expect(mayViewTitle({ isTester: true }, getOut, 'test')).toBe(false);
    expect(mayViewTitle({ canPreviewAll: true }, getOut, 'test')).toBe(true);
  });
});

describe('readCatalogueMode', () => {
  const prismaWith = (row: any) =>
    ({ appSettings: { findUnique: jest.fn().mockResolvedValue(row) } }) as any;

  it("reads 'live' only when it is set explicitly", async () => {
    expect(await readCatalogueMode(prismaWith({ catalogueMode: 'live' }))).toBe('live');
  });

  it('falls back to test for anything else', async () => {
    // Fail closed: a missing row, an unrun migration or a typo must leave the
    // site showing test content, never quietly publish the held-back catalogue.
    for (const row of [null, {}, { catalogueMode: 'test' }, { catalogueMode: '' }, { catalogueMode: 'LIVE' }]) {
      expect(await readCatalogueMode(prismaWith(row))).toBe('test');
    }
  });
});

/**
 * Every catalogue read has to go through the helper. A new rail that writes its
 * own `published: true` would work today and silently show live titles to a
 * tester — or worse, be copied into a path where it shows test titles to
 * everyone. This asserts the file contains no hand-written audience clause.
 */
describe('catalogue queries all use the helper', () => {
  const source = require('fs').readFileSync(
    require('path').join(__dirname, 'titles.service.ts'),
    'utf8',
  );

  it('titles.service.ts contains no literal published/isTest filter', () => {
    expect(source).not.toMatch(/published:\s*true/);
    expect(source).not.toMatch(/isTest:\s*true/);
  });

  // An earlier version missed a raw-SQL rail that still said
  // `t.published = true`, so testers were served live titles in Top 10. The
  // predicate now lives in audienceSql(), so the guard is that the raw query
  // interpolates that helper rather than spelling a rule out for itself.
  it('the raw-SQL rail asks the helper for its predicate', () => {
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .map((l: string) => l.replace(/^\s*\/\/.*$/, ''))
      .join('\n');

    expect(code).not.toMatch(/t\.(published|is_test)\s*=\s*true/);
    expect(code).toMatch(/Prisma\.raw\(\s*audienceSql\(/);
  });

  it('every public read takes a viewer argument', () => {
    for (const method of ['browse', 'home', 'findBySlug', 'similar']) {
      expect(source).toMatch(new RegExp(`async ${method}\\s*\\([^)]*viewer`, 's'));
    }
  });

  it('every audience clause is built with a mode, never a default', () => {
    // A one-argument call would compile only if audienceWhere grew a default
    // mode — which would quietly reinstate "published" as the fallback.
    const calls = source.match(/audienceWhere\([^)]*\)/g) ?? [];
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call).toMatch(/,/);
  });
});

describe('TitlesService shape', () => {
  it('still exposes the shared episode include used by list cards', () => {
    expect(TitlesService.cardEpisodeInclude).toBeDefined();
  });
});
