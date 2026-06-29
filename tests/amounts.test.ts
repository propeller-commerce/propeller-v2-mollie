import { toCents, toMollieValue } from '../src/propeller/amounts';

describe('toCents', () => {
  it('converts whole euros', () => {
    expect(toCents(10)).toBe(1000);
    expect(toCents('10.00')).toBe(1000);
  });

  it('handles the classic float-drift cases', () => {
    // 1.1 * 100 === 110.00000000000001 without rounding
    expect(toCents(1.1)).toBe(110);
    expect(toCents('1.1')).toBe(110);
    expect(toCents(0.1 + 0.2)).toBe(30); // 0.30000000000000004 * 100
  });

  it('rounds at the cent boundary', () => {
    expect(toCents(9.999)).toBe(1000);
    expect(toCents(9.994)).toBe(999);
    expect(toCents('19.95')).toBe(1995);
  });

  it('handles zero', () => {
    expect(toCents(0)).toBe(0);
    expect(toCents('0.00')).toBe(0);
  });

  it('throws on invalid / negative input', () => {
    expect(() => toCents('not-a-number')).toThrow();
    expect(() => toCents(-1)).toThrow();
    expect(() => toCents(NaN)).toThrow();
    expect(() => toCents(Infinity)).toThrow();
  });
});

describe('toMollieValue', () => {
  it('formats with two decimals', () => {
    expect(toMollieValue(10)).toBe('10.00');
    expect(toMollieValue('9.9')).toBe('9.90');
    expect(toMollieValue(19.95)).toBe('19.95');
    expect(toMollieValue(0)).toBe('0.00');
  });

  it('rounds to two decimals', () => {
    expect(toMollieValue(9.999)).toBe('10.00');
    expect(toMollieValue(9.994)).toBe('9.99');
  });

  it('throws on invalid / negative input', () => {
    expect(() => toMollieValue('x')).toThrow();
    expect(() => toMollieValue(-5)).toThrow();
  });
});
