import { classifyPayment, type MolliePaymentSnapshot } from '../src/mollie/statusLadder';
import {
  PaymentStatuses,
  TransactionTypes,
  TransactionStatuses,
} from '@propeller-commerce/propeller-sdk-v2';
import { OrderStatus } from '../src/enums';

function snap(partial: Partial<MolliePaymentSnapshot> & { status: string }): MolliePaymentSnapshot {
  return { hasRefunds: false, hasChargebacks: false, ...partial };
}

describe('classifyPayment — the webhook status ladder', () => {
  it('paid (no refund/chargeback) → PAID / NEW, fulfil', () => {
    const out = classifyPayment(snap({ status: 'paid' }))!;
    expect(out.transactionType).toBe(TransactionTypes.PAY);
    expect(out.transactionStatus).toBe(TransactionStatuses.SUCCESS);
    expect(out.paymentStatus).toBe(PaymentStatuses.PAID);
    expect(out.orderStatus).toBe(OrderStatus.NEW);
    expect(out.deleteCart).toBe(true);
  });

  it('open → OPEN / UNFINISHED, fulfil', () => {
    const out = classifyPayment(snap({ status: 'open' }))!;
    expect(out.transactionStatus).toBe(TransactionStatuses.OPEN);
    expect(out.paymentStatus).toBe(PaymentStatuses.OPEN);
    expect(out.orderStatus).toBe(OrderStatus.UNFINISHED);
    expect(out.deleteCart).toBe(true);
  });

  it('pending → PENDING / UNFINISHED, fulfil', () => {
    const out = classifyPayment(snap({ status: 'pending' }))!;
    expect(out.transactionStatus).toBe(TransactionStatuses.PENDING);
    expect(out.paymentStatus).toBe(PaymentStatuses.PENDING);
    expect(out.orderStatus).toBe(OrderStatus.UNFINISHED);
    expect(out.deleteCart).toBe(true);
  });

  it('failed → FAILED / UNFINISHED, no fulfil', () => {
    const out = classifyPayment(snap({ status: 'failed' }))!;
    expect(out.transactionStatus).toBe(TransactionStatuses.FAILED);
    expect(out.paymentStatus).toBe(PaymentStatuses.FAILED);
    expect(out.orderStatus).toBe(OrderStatus.UNFINISHED);
    expect(out.deleteCart).toBe(false);
  });

  it('expired → EXPIRED / UNFINISHED, no fulfil', () => {
    const out = classifyPayment(snap({ status: 'expired' }))!;
    expect(out.transactionStatus).toBe(TransactionStatuses.FAILED);
    expect(out.paymentStatus).toBe(PaymentStatuses.EXPIRED);
    expect(out.orderStatus).toBe(OrderStatus.UNFINISHED);
    expect(out.deleteCart).toBe(false);
  });

  it('canceled (both spellings) → CANCELLED / UNFINISHED, no fulfil', () => {
    for (const status of ['canceled', 'cancelled']) {
      const out = classifyPayment(snap({ status }))!;
      expect(out.paymentStatus).toBe(PaymentStatuses.CANCELLED);
      expect(out.orderStatus).toBe(OrderStatus.UNFINISHED);
      expect(out.deleteCart).toBe(false);
    }
  });

  it('refunds (status still paid, but hasRefunds) → REFUND txn, PAID / NEW, fulfil', () => {
    // The first branch is short-circuited by hasRefunds, so this reaches the
    // refund branch — matching the plugin.
    const out = classifyPayment(snap({ status: 'paid', hasRefunds: true }))!;
    expect(out.transactionType).toBe(TransactionTypes.REFUND);
    expect(out.transactionStatus).toBe(TransactionStatuses.SUCCESS);
    expect(out.paymentStatus).toBe(PaymentStatuses.PAID);
    expect(out.orderStatus).toBe(OrderStatus.NEW);
    expect(out.deleteCart).toBe(true);
  });

  it('chargebacks → CHARGEBACK txn, CHARGEBACK / NEW, fulfil', () => {
    const out = classifyPayment(snap({ status: 'paid', hasChargebacks: true }))!;
    expect(out.transactionType).toBe(TransactionTypes.CHARGEBACK);
    expect(out.transactionStatus).toBe(TransactionStatuses.SUCCESS);
    expect(out.paymentStatus).toBe(PaymentStatuses.CHARGEBACK);
    expect(out.orderStatus).toBe(OrderStatus.NEW);
    expect(out.deleteCart).toBe(true);
  });

  it('is case-insensitive on the status string', () => {
    expect(classifyPayment(snap({ status: 'PAID' }))!.paymentStatus).toBe(PaymentStatuses.PAID);
  });

  it('returns null for an unrecognised status with no refund/chargeback', () => {
    expect(classifyPayment(snap({ status: 'authorized' }))).toBeNull();
    expect(classifyPayment(snap({ status: 'weird' }))).toBeNull();
  });
});
