/**
 * The Mollie webhook status ladder.
 *
 * Mollie's webhook only sends a payment `id`; we re-fetch the payment and map
 * its state to the Propeller status tuple. This is a faithful port of the
 * `if/elseif` chain in the WordPress plugin's `webhook.php`.
 *
 * **Branch order matters.** `paid` (without refunds/chargebacks) is decided
 * before the refund/chargeback branches, exactly as the plugin does.
 *
 * We branch on a small, version-stable snapshot of the Mollie payment rather
 * than on the client's `isPaid()/isOpen()/...` predicate methods, so this file
 * is pure and trivially unit-testable, and won't break if the client renames a
 * helper across majors. The caller (`mollie/client.ts`) builds the snapshot.
 */

import { PaymentStatuses } from '@propeller-commerce/propeller-sdk-v2';
import { TransactionTypes } from '@propeller-commerce/propeller-sdk-v2';
import { TransactionStatuses } from '@propeller-commerce/propeller-sdk-v2';
import { OrderStatus, OrderStatusValue } from '../enums';

/**
 * The version-stable subset of a Mollie payment we need to classify it.
 * `status` is Mollie's canonical payment status string; the two booleans come
 * from `hasRefunds()` / `hasChargebacks()` (or equivalent inspection).
 */
export interface MolliePaymentSnapshot {
  /** Mollie payment status: open | pending | paid | failed | expired | canceled | authorized */
  status: string;
  hasRefunds: boolean;
  hasChargebacks: boolean;
}

export interface PropellerStatusOutcome {
  transactionType: TransactionTypes;
  transactionStatus: TransactionStatuses;
  paymentStatus: PaymentStatuses;
  orderStatus: OrderStatusValue;
  /** Whether the originating cart should be cleared + confirmation email sent. */
  deleteCart: boolean;
}

/**
 * Classify a Mollie payment into the Propeller status tuple.
 *
 * Mirrors `webhook.php` exactly:
 *  - paid (no refund/chargeback) → PAID / NEW, clear cart
 *  - open                        → OPEN / UNFINISHED, clear cart
 *  - pending                     → PENDING / UNFINISHED, clear cart
 *  - failed                      → FAILED / UNFINISHED
 *  - expired                     → EXPIRED / UNFINISHED
 *  - canceled                    → CANCELLED / UNFINISHED
 *  - has refunds                 → REFUND txn, PAID / NEW, clear cart
 *  - has chargebacks             → CHARGEBACK txn, CHARGEBACK / NEW, clear cart
 *
 * Returns `null` for an unrecognised state (caller should log and no-op rather
 * than push a wrong status).
 */
export function classifyPayment(
  snapshot: MolliePaymentSnapshot
): PropellerStatusOutcome | null {
  const status = (snapshot.status ?? '').toLowerCase();
  const isPaid = status === 'paid';

  // paid, and not refunded or charged back — checked first (plugin order).
  if (isPaid && !snapshot.hasRefunds && !snapshot.hasChargebacks) {
    return {
      transactionType: TransactionTypes.PAY,
      transactionStatus: TransactionStatuses.SUCCESS,
      paymentStatus: PaymentStatuses.PAID,
      orderStatus: OrderStatus.NEW,
      deleteCart: true,
    };
  }

  if (status === 'open') {
    return {
      transactionType: TransactionTypes.PAY,
      transactionStatus: TransactionStatuses.OPEN,
      paymentStatus: PaymentStatuses.OPEN,
      orderStatus: OrderStatus.UNFINISHED,
      deleteCart: true,
    };
  }

  if (status === 'pending') {
    return {
      transactionType: TransactionTypes.PAY,
      transactionStatus: TransactionStatuses.PENDING,
      paymentStatus: PaymentStatuses.PENDING,
      orderStatus: OrderStatus.UNFINISHED,
      deleteCart: true,
    };
  }

  if (status === 'failed') {
    return {
      transactionType: TransactionTypes.PAY,
      transactionStatus: TransactionStatuses.FAILED,
      paymentStatus: PaymentStatuses.FAILED,
      orderStatus: OrderStatus.UNFINISHED,
      deleteCart: false,
    };
  }

  if (status === 'expired') {
    return {
      transactionType: TransactionTypes.PAY,
      transactionStatus: TransactionStatuses.FAILED,
      paymentStatus: PaymentStatuses.EXPIRED,
      orderStatus: OrderStatus.UNFINISHED,
      deleteCart: false,
    };
  }

  if (status === 'canceled' || status === 'cancelled') {
    return {
      transactionType: TransactionTypes.PAY,
      transactionStatus: TransactionStatuses.FAILED,
      paymentStatus: PaymentStatuses.CANCELLED,
      orderStatus: OrderStatus.UNFINISHED,
      deleteCart: false,
    };
  }

  // Refund/chargeback branches — the plugin reaches these when status isn't one
  // of the above (a paid payment that later refunds keeps status "paid", so it
  // is caught by the first branch unless the refund/chargeback flags are set,
  // which is why those flags also short-circuit the first branch above).
  if (snapshot.hasRefunds) {
    return {
      transactionType: TransactionTypes.REFUND,
      transactionStatus: TransactionStatuses.SUCCESS,
      paymentStatus: PaymentStatuses.PAID,
      orderStatus: OrderStatus.NEW,
      deleteCart: true,
    };
  }

  if (snapshot.hasChargebacks) {
    return {
      transactionType: TransactionTypes.CHARGEBACK,
      transactionStatus: TransactionStatuses.SUCCESS,
      paymentStatus: PaymentStatuses.CHARGEBACK,
      orderStatus: OrderStatus.NEW,
      deleteCart: true,
    };
  }

  return null;
}
