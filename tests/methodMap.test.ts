import { resolveMollieMethod } from '../src/mollie/methodMap';

describe('resolveMollieMethod', () => {
  it('maps known Propeller method codes to Mollie methods', () => {
    expect(resolveMollieMethod('ideal')).toBe('ideal');
    expect(resolveMollieMethod('creditcard')).toBe('creditcard');
    expect(resolveMollieMethod('bancontact')).toBe('bancontact');
    expect(resolveMollieMethod('paypal')).toBe('paypal');
    expect(resolveMollieMethod('klarnapaylater')).toBe('klarnapaylater');
  });

  it('maps the multisafepay_ideal alias to ideal (plugin parity)', () => {
    expect(resolveMollieMethod('multisafepay_ideal')).toBe('ideal');
  });

  it('is case-insensitive and trims', () => {
    expect(resolveMollieMethod('IDEAL')).toBe('ideal');
    expect(resolveMollieMethod('  PayPal  ')).toBe('paypal');
  });

  it('falls back to creditcard for unknown / empty / null codes', () => {
    expect(resolveMollieMethod('something-unknown')).toBe('creditcard');
    expect(resolveMollieMethod('')).toBe('creditcard');
    expect(resolveMollieMethod(undefined)).toBe('creditcard');
    expect(resolveMollieMethod(null)).toBe('creditcard');
  });
});
