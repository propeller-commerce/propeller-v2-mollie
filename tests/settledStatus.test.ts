import { isSettledStatus } from '../src/MollieProvider';

describe('isSettledStatus — local-cart-deletion rule per Mollie status', () => {
  it('settles (clear cart) ONLY for captured payments: paid / authorized', () => {
    for (const s of ['paid', 'authorized']) {
      expect(isSettledStatus(s)).toBe(true);
    }
  });

  it('does NOT settle (keep cart) for open / pending — not resolved yet', () => {
    for (const s of ['open', 'pending']) {
      expect(isSettledStatus(s)).toBe(false);
    }
  });

  it('does NOT settle (keep cart) for failed / canceled / expired', () => {
    for (const s of ['failed', 'canceled', 'cancelled', 'expired']) {
      expect(isSettledStatus(s)).toBe(false);
    }
  });

  it('is case-insensitive', () => {
    expect(isSettledStatus('PAID')).toBe(true);
    expect(isSettledStatus('Open')).toBe(false);
    expect(isSettledStatus('Failed')).toBe(false);
  });

  it('treats unknown / empty as not settled', () => {
    expect(isSettledStatus('')).toBe(false);
    expect(isSettledStatus('whatever')).toBe(false);
  });
});
