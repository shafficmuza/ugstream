import { notifiableAudience } from '../titles/audience';
import { PushService } from './push.service';

/**
 * Who gets told about a new title.
 *
 * Every announcement used to go to every registered handset: a tester was
 * pushed live titles they cannot open, and the whole user base was pushed test
 * content. A notification that leads to "Title not found" is worse than no
 * notification — it advertises something the catalogue then denies.
 *
 * The rule is the catalogue's own, asked about people instead of rows.
 */
describe('notifiableAudience', () => {
  const testTitle = { isTest: true, published: true };
  const liveTitle = { isTest: false, published: true };

  describe('test mode — the site is the test catalogue', () => {
    it('announces a test title to everyone, because everyone can open it', () => {
      expect(notifiableAudience(testTitle, 'test')).toEqual({
        ordinary: true,
        testers: true,
        earlyAccess: true,
      });
    });

    it('announces a held-back title to Early access alone', () => {
      // The whole point of test mode: nobody else can reach this title, so
      // nobody else hears about it.
      expect(notifiableAudience(liveTitle, 'test')).toEqual({
        ordinary: false,
        testers: false,
        earlyAccess: true,
      });
    });
  });

  describe('live mode — the ordinary arrangement after launch', () => {
    it('keeps live titles away from testers, who are on the other catalogue', () => {
      expect(notifiableAudience(liveTitle, 'live')).toEqual({
        ordinary: true,
        testers: false,
        earlyAccess: true,
      });
    });

    it('sends test titles to testers and nobody else ordinary', () => {
      expect(notifiableAudience({ isTest: true, published: false }, 'live')).toEqual({
        ordinary: false,
        testers: true,
        earlyAccess: true,
      });
    });
  });
});

describe('PushService device selection', () => {
  const build = () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = new PushService(
      { device: { findMany } } as any, // prisma
      { get: jest.fn() } as any, // secrets
      { get: jest.fn() } as any, // config
    );
    return { service, findMany };
  };

  /** The private query is the whole point of the change, so reach it directly. */
  const tokensFor = async (audience: string, visibleTo?: any) => {
    const { service, findMany } = build();
    await (service as any).audienceTokens(audience, visibleTo);
    return findMany.mock.calls[0][0].where;
  };

  it('asks for every non-banned handset when no title narrows it', async () => {
    const where = await tokensFor('all');
    expect(where.AND).toBeUndefined();
  });

  it('excludes testers from a title they cannot open', async () => {
    const where = await tokensFor('all', { ordinary: true, testers: false, earlyAccess: true });
    const clauses = where.AND[0].OR;

    expect(clauses).toContainEqual({ userId: null });
    expect(clauses).toContainEqual({ user: { isTester: false, canPreviewAll: false } });
    expect(clauses).toContainEqual({ user: { canPreviewAll: true } });
    expect(clauses).not.toContainEqual({ user: { isTester: true } });
  });

  it('leaves only Early access for a held-back title', async () => {
    const where = await tokensFor('all', { ordinary: false, testers: false, earlyAccess: true });
    expect(where.AND[0].OR).toEqual([{ user: { canPreviewAll: true } }]);
  });

  it('treats a signed-out handset as an ordinary viewer, not as nobody', async () => {
    // It sees whatever an anonymous visitor sees, so it hears about the same
    // titles — dropping it would silence every handset that has not signed in,
    // which is precisely the audience a new-title announcement is for.
    const ordinary = await tokensFor('all', { ordinary: true, testers: true, earlyAccess: true });
    expect(ordinary.AND[0].OR).toContainEqual({ userId: null });

    const heldBack = await tokensFor('all', { ordinary: false, testers: true, earlyAccess: true });
    expect(heldBack.AND[0].OR).not.toContainEqual({ userId: null });
  });

  it('still narrows subscribers by what they can open', async () => {
    const where = await tokensFor('subscribers', {
      ordinary: false,
      testers: false,
      earlyAccess: true,
    });
    expect(where.user.subscriptions).toBeDefined();
    expect(where.AND[0].OR).toEqual([{ user: { canPreviewAll: true } }]);
  });
});
