/**
 * Propeller order-status string values used by this provider.
 *
 * Payment-status, transaction-type and transaction-status enums are NOT
 * redefined here — re-export the SDK's `PaymentStatuses`, `TransactionTypes`
 * and `TransactionStatuses` instead (their string values are authoritative and
 * already match what the backend expects). See `index.ts`.
 *
 * Order status is a plain `string` on `OrderSetStatusInput.status` (the SDK has
 * no enum for it), so we keep the names the WordPress plugin used as a small
 * local const for readability and to avoid stray string literals.
 */
export const OrderStatus = {
  NEW: 'NEW',
  REQUEST: 'REQUEST',
  QUOTATION: 'QUOTATION',
  VALIDATED: 'VALIDATED',
  CONFIRMED: 'CONFIRMED',
  ARCHIVED: 'ARCHIVED',
  UNFINISHED: 'UNFINISHED',
} as const;

export type OrderStatusValue = (typeof OrderStatus)[keyof typeof OrderStatus];
