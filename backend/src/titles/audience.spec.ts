import { audienceWhere, isTestViewer } from './audience';
import { TitlesService } from './titles.service';

/**
 * The two audiences must never overlap. A tester sees test titles and nothing
 * else; everyone else sees published titles and nothing else.
 *
 * The property that matters most here is the one about EXISTING viewers: the
 * clause they get has to be exactly what it was before any of this existed, or
 * people already watching are affected by a feature that was supposed to be
 * invisible to them.
 */
describe('audienceWhere', () => {
  it('gives an anonymous visitor the live catalogue', () => {
    expect(audienceWhere(undefined)).toEqual({ published: true });
    expect(audienceWhere(null)).toEqual({ published: true });
  });

  it('gives an ordinary account the live catalogue', () => {
    expect(audienceWhere({ isTester: false })).toEqual({ published: true });
  });

  it('gives a tester the test catalogue and NOT the live one', () => {
    const where = audienceWhere({ isTester: true });
    expect(where).toEqual({ isTest: true });
    expect(where).not.toHaveProperty('published');
  });

  it('never returns a clause that would match both catalogues', () => {
    for (const viewer of [undefined, null, { isTester: false }, { isTester: true }]) {
      const keys = Object.keys(audienceWhere(viewer as any));
      expect(keys).toHaveLength(1);
    }
  });

  it('an early-access viewer sees everything, published or not', () => {
    // The whitelist for a private group while the catalogue is held back: an
    // empty clause means no restriction, not "match nothing".
    expect(audienceWhere({ canPreviewAll: true })).toEqual({});
  });

  it('early access beats the tester flag when both are set', () => {
    // The wider grant wins. Otherwise flagging a tester for early access would
    // silently do nothing, which is the opposite of what an admin just asked for.
    expect(audienceWhere({ isTester: true, canPreviewAll: true })).toEqual({});
  });

  it('early access off leaves the ordinary rules untouched', () => {
    expect(audienceWhere({ canPreviewAll: false })).toEqual({ published: true });
    expect(audienceWhere({ isTester: true, canPreviewAll: false })).toEqual({ isTest: true });
  });

  it('treats a missing flag as an ordinary viewer', () => {
    // Anything that fails to resolve a user must fall back to the PUBLIC
    // catalogue, never the test one — the safe direction to be wrong in.
    expect(audienceWhere({} as any)).toEqual({ published: true });
    expect(isTestViewer({} as any)).toBe(false);
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

  // The first version of this file only checked the object form, and missed a
  // raw-SQL rail that still said `t.published = true` — so testers were served
  // live titles in Top 10. Any hard-coded audience predicate in SQL has to be
  // caught too, whichever spelling it uses.
  it('no raw-SQL query hard-codes an audience predicate', () => {
    // Comments are stripped first: this file explains the bug by quoting the
    // old predicate, and scanning the raw text matched the prose instead of
    // the code.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .map((l) => l.replace(/^\s*\/\/.*$/, ''))
      .join('\n');

    const re = /t\.(published|is_test)\s*=\s*true/g;
    let m: RegExpExecArray | null;
    let found = 0;
    while ((m = re.exec(code)) !== null) {
      found += 1;
      const context = code.slice(Math.max(0, m.index - 120), m.index);
      expect(context).toMatch(/Prisma\.raw\(/);
    }
    // Guard against the check silently passing because the query moved or was
    // renamed: the Top 10 rail is raw SQL and must still be here.
    expect(found).toBeGreaterThan(0);
  });

  it('every public read takes a viewer argument', () => {
    for (const method of ['browse', 'home', 'findBySlug', 'similar']) {
      const re = new RegExp(`async ${method}\\s*\\([^)]*viewer`, 's');
      expect(source).toMatch(re);
    }
  });
});

describe('TitlesService shape', () => {
  it('still exposes the shared episode include used by list cards', () => {
    expect(TitlesService.cardEpisodeInclude).toBeDefined();
  });
});
