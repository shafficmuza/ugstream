import { MeController } from './me.controller';

/**
 * /me must say which catalogue the account is served.
 *
 * It did not, and that is how a real incident stayed invisible: early access
 * was granted to a mistyped phone number, so the intended account kept seeing
 * the small public catalogue. From inside the app that is indistinguishable
 * from a broken guard — the only way to tell them apart was a database query.
 */
describe('MeController audience flags', () => {
  const controller = new MeController(null as any);
  const base = {
    id: BigInt(1),
    phone: '+256700000000',
    displayName: null,
    email: null,
    address: null,
    role: 'user',
  };

  const toPublic = (u: any) => (controller as any).toPublic(u);

  it('reports an ordinary account as neither', () => {
    const out = toPublic(base);
    expect(out.isTester).toBe(false);
    expect(out.canPreviewAll).toBe(false);
  });

  it('reports a tester and a previewer distinctly', () => {
    expect(toPublic({ ...base, isTester: true }).isTester).toBe(true);
    expect(toPublic({ ...base, canPreviewAll: true }).canPreviewAll).toBe(true);
  });

  it('still never exposes the PIN hash', () => {
    const out = toPublic({ ...base, pinHash: '$2a$10$notarealhash' });
    expect(out.pinSet).toBe(true);
    expect(JSON.stringify(out)).not.toContain('notarealhash');
    expect(out).not.toHaveProperty('pinHash');
  });
});
