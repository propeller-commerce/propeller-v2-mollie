/**
 * Map a Propeller payment-method code to a Mollie payment method.
 *
 * Mirrors the `switch` in the WordPress plugin
 * (`PropellerMollie::create`). We map to Mollie's canonical lowercase method
 * **string literals** rather than the client's `PaymentMethod` enum export —
 * the strings are what the Mollie API accepts and are stable across client
 * major versions, so this avoids breakage if the enum's export name changes.
 *
 * Unknown codes fall back to `creditcard`, matching the plugin's `default`.
 * Passing `undefined` to Mollie (i.e. letting Mollie show its hosted method
 * selection) is intentionally NOT the default here, to preserve plugin parity;
 * a caller that wants Mollie's selector can pass a method code that maps to
 * `null` — see `resolveMollieMethod`.
 */

/** Canonical Mollie method identifiers (subset used by the plugin). */
export type MollieMethod =
  | 'ideal'
  | 'creditcard'
  | 'bancontact'
  | 'applepay'
  | 'belfius'
  | 'banktransfer'
  | 'directdebit'
  | 'eps'
  | 'giftcard'
  | 'giropay'
  | 'kbc'
  | 'klarnapaylater'
  | 'klarnapaynow'
  | 'klarnasliceit'
  | 'mybank'
  | 'paypal'
  | 'paysafecard'
  | 'przelewy24'
  | 'sofort';

const METHOD_MAP: Record<string, MollieMethod> = {
  ideal: 'ideal',
  multisafepay_ideal: 'ideal',
  creditcard: 'creditcard',
  bancontact: 'bancontact',
  applepay: 'applepay',
  belfius: 'belfius',
  banktransfer: 'banktransfer',
  directdebit: 'directdebit',
  eps: 'eps',
  giftcard: 'giftcard',
  giropay: 'giropay',
  kbc: 'kbc',
  klarnapaylater: 'klarnapaylater',
  klarnapaynow: 'klarnapaynow',
  klarnasliceit: 'klarnasliceit',
  mybank: 'mybank',
  paypal: 'paypal',
  paysafecard: 'paysafecard',
  przelewy24: 'przelewy24',
  sofort: 'sofort',
};

/**
 * Resolve a Propeller method code to a Mollie method.
 * Unknown/empty codes return `'creditcard'` (plugin parity).
 */
export function resolveMollieMethod(propellerMethod: string | undefined | null): MollieMethod {
  const key = (propellerMethod ?? '').toLowerCase().trim();
  return METHOD_MAP[key] ?? 'creditcard';
}
