/**
 * Amount conversion between Mollie and Propeller.
 *
 * - **Mollie** represents amounts as a decimal **string** in major units, e.g.
 *   `"10.00"` (and always with two decimals for EUR-like currencies).
 * - **Propeller** represents amounts as an **integer number of cents** (minor
 *   units), e.g. `1000`.
 *
 * The WordPress plugin did `(int) round(floatval($value) * 100)`. Naive
 * `value * 100` in JS hits floating-point error (`1.1 * 100 === 110.00000000000001`),
 * so we round explicitly. `Math.round` is correct here for the cent precision we
 * need across realistic order totals.
 */

/**
 * Convert a major-unit amount (number or Mollie decimal string) to integer
 * cents for Propeller inputs.
 *
 * @throws if the value is not a finite, non-negative number.
 */
export function toCents(value: string | number): number {
  const major = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(major) || major < 0) {
    throw new Error(`Invalid amount for cents conversion: ${JSON.stringify(value)}`);
  }
  // Round at the cent boundary to absorb binary-float drift.
  return Math.round(major * 100);
}

/**
 * Format a major-unit amount as a Mollie decimal string with two decimals,
 * e.g. `10` -> `"10.00"`, `"9.9"` -> `"9.90"`.
 *
 * @throws if the value is not a finite, non-negative number.
 */
export function toMollieValue(value: string | number): string {
  const major = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(major) || major < 0) {
    throw new Error(`Invalid amount for Mollie value: ${JSON.stringify(value)}`);
  }
  return major.toFixed(2);
}
