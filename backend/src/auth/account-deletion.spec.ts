import { AccountService } from './account.service';

/**
 * Self-service account deletion (App Store guideline 5.1.1(v)).
 *
 * The operation is irreversible, so what is worth testing is not that it runs
 * but exactly what it destroys and exactly what it keeps. Two failures matter
 * in opposite directions: keeping something identifying makes the deletion a
 * lie, and destroying a payment row makes it a compliance problem.
 */

function makeService(opts: { user?: any } = {}) {
  const calls: Record<string, any[]> = {
    watchHistory: [], myListItem: [], streamLease: [], session: [], device: [], otpCode: [],
  };
  const update = jest.fn(async (_args: any) => ({}) as any);

  const tx: any = {
    watchHistory: { deleteMany: jest.fn(async (a: any) => calls.watchHistory.push(a)) },
    myListItem: { deleteMany: jest.fn(async (a: any) => calls.myListItem.push(a)) },
    streamLease: { deleteMany: jest.fn(async (a: any) => calls.streamLease.push(a)) },
    session: { deleteMany: jest.fn(async (a: any) => calls.session.push(a)) },
    device: { deleteMany: jest.fn(async (a: any) => calls.device.push(a)) },
    otpCode: { deleteMany: jest.fn(async (a: any) => calls.otpCode.push(a)) },
    user: { update },
    // Present so a stray call would be visible rather than throwing something
    // unrelated: nothing here may touch money.
    payment: { deleteMany: jest.fn(async () => { throw new Error('payments must never be deleted'); }) },
    subscription: { deleteMany: jest.fn(async () => { throw new Error('subscriptions must never be deleted'); }) },
    purchase: { deleteMany: jest.fn(async () => { throw new Error('purchases must never be deleted'); }) },
  };

  const prisma: any = {
    user: {
      findUnique: jest.fn(async () =>
        opts.user === undefined
          ? { id: 61n, phone: '+256775200443', status: 'active' }
          : opts.user),
      update,
    },
    subscription: { findFirst: jest.fn(async () => null) },
    watchHistory: { count: jest.fn(async () => 7) },
    myListItem: { count: jest.fn(async () => 3) },
    session: { count: jest.fn(async () => 2) },
    $transaction: jest.fn(async (fn: any) => fn(tx)),
  };

  const service = new AccountService(prisma);
  (service as any).logger = { log: () => {}, warn: () => {}, error: () => {} };
  return { service, prisma, tx, update, calls };
}

describe('deleting your own account', () => {
  it('destroys every trace of the person', async () => {
    const { service, tx } = makeService();
    await service.deleteOwn(61n);

    for (const table of ['watchHistory', 'myListItem', 'streamLease', 'session', 'device']) {
      expect((tx as any)[table].deleteMany).toHaveBeenCalledWith({ where: { userId: 61n } });
    }
    // Outstanding codes go by phone, not by user: a code already in flight
    // must not be usable against the new account this number can now create.
    expect(tx.otpCode.deleteMany).toHaveBeenCalledWith({ where: { phone: '+256775200443' } });
  });

  it('never touches money', async () => {
    const { service, tx } = makeService();
    await service.deleteOwn(61n);
    // These would throw if called. Payments, subscriptions and purchases are
    // financial records that must outlive the account.
    expect(tx.payment.deleteMany).not.toHaveBeenCalled();
    expect(tx.subscription.deleteMany).not.toHaveBeenCalled();
    expect(tx.purchase.deleteMany).not.toHaveBeenCalled();
  });

  it('empties the row instead of removing it, and frees the number', async () => {
    const { service, update } = makeService();
    await service.deleteOwn(61n);

    const arg = (update.mock.calls[0] as any[])[0];
    expect(arg.where).toEqual({ id: 61n });
    // The number is the login identifier: releasing it is what makes the old
    // account unreachable and lets the same person sign up fresh.
    expect(arg.data.phone).toBe('deleted:61');
    expect(arg.data.phone.length).toBeLessThanOrEqual(20); // column is VarChar(20)
    for (const field of ['displayName', 'email', 'address', 'pinHash', 'pinSetAt', 'pinLockedUntil']) {
      expect(arg.data[field]).toBeNull();
    }
    expect(arg.data.status).toBe('deleted');
    expect(arg.data.deletedAt).toBeInstanceOf(Date);
  });

  it('does it all in one transaction', async () => {
    const { service, prisma } = makeService();
    await service.deleteOwn(61n);
    // A half-deletion — history gone but the phone still resolving — would
    // leave someone signed in to a hollow account they asked to be rid of.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('is safe to repeat', async () => {
    const { service, prisma } = makeService({
      user: { id: 61n, phone: 'deleted:61', status: 'deleted' },
    });
    await service.deleteOwn(61n);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('does nothing for an id that is not there', async () => {
    const { service, prisma } = makeService({ user: null });
    await expect(service.deleteOwn(999n)).resolves.toBeUndefined();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('summarises what will be lost, so the confirmation can be specific', async () => {
    const { service, prisma } = makeService();
    const until = new Date(Date.now() + 5 * 86400_000);
    prisma.subscription.findFirst = jest.fn(async () => ({ expiresAt: until }));

    const s = await service.deletionSummary(61n);
    // The active subscription is the one that has to be named: deleting does
    // not refund it and does not cancel anything at the telco.
    expect(s.activeSubscriptionUntil).toBe(until);
    expect(s).toMatchObject({ watchHistoryCount: 7, myListCount: 3, signedInDevices: 2 });
  });
});
