/**
 * Propeller payment writes via the SDK `paymentService`.
 *
 * Mirrors the WordPress `PaymentController::payment_create` / `payment_update`:
 *  - create a Payment (status OPEN) with an initial AUTHORIZATION transaction;
 *  - update a Payment found by `paymentId`, appending a transaction.
 *
 * Transactions are added INLINE via `addTransaction` on the create/update input
 * (the SDK's `CreatePaymentInput.addTransaction` / `UpdatePaymentInput.addTransaction`)
 * — there is no separate transaction mutation, exactly as the plugin does.
 */

import {
  paymentService,
  PaymentStatuses,
  TransactionTypes,
  TransactionStatuses,
  type GraphQLClient,
  type CreatePaymentInput,
  type UpdatePaymentInput,
  type SearchByInput,
  type Payment,
} from '@propeller-commerce/propeller-sdk-v2';
import { toCents } from './amounts';

const PROVIDER = 'Mollie';

export interface CreatePropellerPaymentArgs {
  paymentId: string;
  orderId: number;
  /** Major-unit amount (number or decimal string). Converted to cents here. */
  amount: string | number;
  currency: string;
  method: string;
  userId?: number;
  anonymousId?: number;
}

/**
 * Create the Propeller payment for a freshly created Mollie payment.
 * Payment status OPEN, transaction AUTHORIZATION/OPEN — matches the plugin.
 */
export async function createPropellerPayment(
  client: GraphQLClient,
  args: CreatePropellerPaymentArgs
): Promise<Payment> {
  const amount = toCents(args.amount);

  const input: CreatePaymentInput = {
    orderId: args.orderId,
    amount,
    currency: args.currency,
    method: args.method,
    paymentId: args.paymentId,
    status: PaymentStatuses.OPEN,
    ...(args.userId !== undefined ? { userId: args.userId } : {}),
    ...(args.anonymousId !== undefined ? { anonymousId: args.anonymousId } : {}),
    addTransaction: {
      transactionId: args.paymentId,
      type: TransactionTypes.AUTHORIZATION,
      amount,
      currency: args.currency,
      status: TransactionStatuses.OPEN,
      paymentId: args.paymentId,
      provider: PROVIDER,
    },
  };

  return paymentService(client).createPayment(input);
}

export interface UpdatePropellerPaymentArgs {
  paymentId: string;
  /** Major-unit amount (number or decimal string). Converted to cents here. */
  amount: string | number;
  currency: string;
  paymentStatus: PaymentStatuses;
  transactionType: TransactionTypes;
  transactionStatus: TransactionStatuses;
}

/**
 * Update the Propeller payment (found by `paymentId`) and append a transaction
 * reflecting the webhook outcome. Matches `PaymentController::payment_update`.
 */
export async function updatePropellerPayment(
  client: GraphQLClient,
  args: UpdatePropellerPaymentArgs
): Promise<Payment> {
  const amount = toCents(args.amount);

  const input: UpdatePaymentInput = {
    paymentId: args.paymentId,
    amount,
    currency: args.currency,
    status: args.paymentStatus,
    addTransaction: {
      transactionId: args.paymentId,
      type: args.transactionType,
      amount,
      currency: args.currency,
      status: args.transactionStatus,
      paymentId: args.paymentId,
      provider: PROVIDER,
    },
  };

  const searchBy: SearchByInput = { paymentId: args.paymentId };

  return paymentService(client).updatePayment({ searchBy, input });
}
