import { normalizeUgPhone } from './phone.util';

describe('normalizeUgPhone', () => {
  it.each([
    ['0772123456', '256772123456'],
    ['+256772123456', '256772123456'],
    ['256772123456', '256772123456'],
    ['772123456', '256772123456'],
    ['0700 000 000', '256700000000'],
    ['+256-752-111-222', '256752111222'],
  ])('normalises %s -> %s', (input, expected) => {
    expect(normalizeUgPhone(input)).toBe(expected);
  });

  it.each(['', '123', 'abc', '25677212345', '2567721234567', '077212345'])(
    'rejects invalid %s',
    (bad) => {
      expect(() => normalizeUgPhone(bad)).toThrow();
    },
  );
});
