/**
 * MollieProvider — the public entry point.
 *
 * Drives Mollie PSP payments through the Propeller GraphQL API. Two operations:
 *
 *   1. `createPayment(args)` — create a Mollie payment + a Propeller payment,
 *      and return the Mollie checkout URL to redirect the shopper to.
 *   2. `handleWebhook(molliePaymentId)` — called from the host's webhook route.
 *      Re-fetches the payment from Mollie (never trusts the request body beyond
 *      the id), classifies it, and updates the Propeller payment + order.
 *
 * Transport-agnostic: the host owns the HTTP route and must always respond 200
 * to Mollie. `handleWebhook` therefore NEVER throws — it returns a result object
 * and logs internally, so a downstream error can't turn into a non-2xx that
 * makes Mollie retry forever.
 */

import { MollieGateway } from './mollie/client';
import { resolveMollieMethod } from './mollie/methodMap';
import { classifyPayment } from './mollie/statusLadder';
import { createPropellerPayment, updatePropellerPayment } from './propeller/payments';
import { setPropellerOrderStatus } from './propeller/orders';
import { toMollieValue } from './propeller/amounts';
import { consoleLogger, type Logger } from './logger';
import type {
  MollieProviderConfig,
  MollieProviderHost,
  CreatePaymentArgs,
  CreatePaymentResult,
  HandleWebhookResult,
  MolliePaymentStatus,
  PaymentStatusResult,
} from './types';
import type { GraphQLClient } from '@propeller-commerce/propeller-sdk-v2';

export class MollieProvider {
  private readonly gateway: MollieGateway;
  private readonly client: GraphQLClient;
  private readonly webhookUrl: string;
  private readonly log: Logger;

  /**
   * @param config The three PSP inputs: `{ liveApiKey, testApiKey, testMode }`.
   * @param host   Host wiring: a configured SDK `GraphQLClient` (built with
   *               `orderEditorApiKey` + `securityMode: 'direct'`), the public
   *               `webhookUrl`, and an optional `logger`.
   */
  constructor(config: MollieProviderConfig, host: MollieProviderHost) {
    if (!host?.client) {
      throw new Error('MollieProvider: host.client (a Propeller SDK GraphQLClient) is required.');
    }
    if (!host.webhookUrl) {
      throw new Error('MollieProvider: host.webhookUrl is required (Mollie must POST somewhere public).');
    }
    this.gateway = new MollieGateway(config);
    this.client = host.client;
    this.webhookUrl = host.webhookUrl;
    this.log = host.logger ?? consoleLogger;
  }

  /**
   * Start a payment: create it in Mollie, persist it in Propeller (status OPEN
   * with an AUTHORIZATION transaction), and return the checkout URL.
   *
   * Throws on failure — payment creation happens during the shopper's checkout
   * request, where the host wants to surface the error (unlike the webhook).
   */
  async createPayment(args: CreatePaymentArgs): Promise<CreatePaymentResult> {
    const method = resolveMollieMethod(args.method);

    this.log('info', `Creating Mollie payment for order ${args.orderId} (method=${method})`);

    const created = await this.gateway.createPayment({
      value: toMollieValue(args.amount),
      currency: args.currency,
      description: args.description,
      redirectUrl: args.redirectUrl,
      webhookUrl: this.webhookUrl,
      method,
      orderId: args.orderId,
    });

    if (!created.checkoutUrl) {
      // Some methods (e.g. recurring) have no checkout URL; for a hosted
      // checkout flow this is an error worth surfacing.
      throw new Error(
        `Mollie payment ${created.paymentId} has no checkout URL (method=${method}).`
      );
    }

    // Persist in Propeller (status OPEN + AUTHORIZATION transaction).
    await createPropellerPayment(this.client, {
      paymentId: created.paymentId,
      orderId: args.orderId,
      amount: args.amount,
      currency: args.currency,
      method: args.method,
      userId: args.userId,
      anonymousId: args.anonymousId,
    });

    this.log('info', `Mollie payment ${created.paymentId} created for order ${args.orderId}`);

    return {
      checkoutUrl: created.checkoutUrl,
      paymentId: created.paymentId,
      orderId: args.orderId,
    };
  }

  /**
   * Handle a Mollie webhook. Pass the `id` Mollie POSTed. Re-fetches the
   * payment, classifies it, updates the Propeller payment + order. Always
   * resolves (never throws) so the host can unconditionally return 200.
   */
  async handleWebhook(molliePaymentId: string): Promise<HandleWebhookResult> {
    if (!molliePaymentId) {
      this.log('warn', 'Webhook called without a payment id');
      return { ok: false, paymentId: '', error: 'missing payment id' };
    }

    try {
      // 1. Re-fetch from Mollie — never trust the request body beyond the id.
      const fetched = await this.gateway.getPaymentSnapshot(molliePaymentId);

      this.log(
        'info',
        `Webhook: payment ${molliePaymentId} status=${fetched.snapshot.status} order=${fetched.orderId ?? 'n/a'}`
      );

      if (fetched.orderId === undefined) {
        this.log('error', `Webhook: payment ${molliePaymentId} has no order_id in metadata`);
        return {
          ok: false,
          paymentId: molliePaymentId,
          mollieStatus: fetched.snapshot.status,
          error: 'missing order_id in payment metadata',
        };
      }

      // 2. Classify the Mollie state into the Propeller status tuple.
      const outcome = classifyPayment(fetched.snapshot);
      if (!outcome) {
        this.log('warn', `Webhook: unhandled Mollie status "${fetched.snapshot.status}" for ${molliePaymentId}`);
        return {
          ok: false,
          paymentId: molliePaymentId,
          orderId: fetched.orderId,
          mollieStatus: fetched.snapshot.status,
          error: `unhandled status: ${fetched.snapshot.status}`,
        };
      }

      // 3. Update the Propeller payment (+ append transaction). Use Mollie's
      //    authoritative amount/currency, not a client-supplied value.
      await updatePropellerPayment(this.client, {
        paymentId: molliePaymentId,
        amount: fetched.amount,
        currency: fetched.currency,
        paymentStatus: outcome.paymentStatus,
        transactionType: outcome.transactionType,
        transactionStatus: outcome.transactionStatus,
      });

      // 4. Update the Propeller order status (+ confirm/clear-cart on fulfil).
      await setPropellerOrderStatus(this.client, {
        orderId: fetched.orderId,
        orderStatus: outcome.orderStatus,
        payStatus: outcome.paymentStatus,
        fulfil: outcome.deleteCart,
      });

      this.log(
        'info',
        `Webhook: processed ${molliePaymentId} → payment=${outcome.paymentStatus}, order=${outcome.orderStatus}`
      );

      return {
        ok: true,
        paymentId: molliePaymentId,
        orderId: fetched.orderId,
        mollieStatus: fetched.snapshot.status,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log('error', `Webhook: error processing ${molliePaymentId}: ${message}`, err);
      // Swallow — the host still returns 200; Mollie will retry, and a transient
      // failure recovers on the next delivery without a poison-retry loop.
      return { ok: false, paymentId: molliePaymentId, error: message };
    }
  }

  /**
   * Fetch the live Mollie payment status for a payment id. Read-only — does NOT
   * touch Propeller. Intended for the return page so the UI can reflect the real
   * outcome (open / paid / failed / canceled / expired) without waiting on, or
   * being misled by, the async webhook + order status.
   *
   * `settled` is the local-cart-deletion hint: true only for `paid`/`authorized`
   * (captured → clear the cart). It is false for `open`/`pending` (not resolved
   * yet → keep the cart in sync with the live backend cart) and for
   * `failed`/`canceled`/`expired` (keep it so the shopper can retry). Always
   * resolves.
   */
  async getPaymentStatus(molliePaymentId: string): Promise<PaymentStatusResult> {
    if (!molliePaymentId) {
      return { ok: false, paymentId: '', error: 'missing payment id' };
    }
    try {
      const fetched = await this.gateway.getPaymentSnapshot(molliePaymentId);
      const status = fetched.snapshot.status as MolliePaymentStatus;
      return {
        ok: true,
        paymentId: molliePaymentId,
        status,
        settled: isSettledStatus(status),
        orderId: fetched.orderId,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log('error', `getPaymentStatus: error for ${molliePaymentId}: ${message}`, err);
      return { ok: false, paymentId: molliePaymentId, error: message };
    }
  }
}

/**
 * Whether a Mollie status means the shopper's LOCAL cart should be cleared on
 * the return page — i.e. the payment is actually captured and the order is being
 * finalized. Only `paid` / `authorized` qualify.
 *
 * `open` / `pending` deliberately return false: the payment isn't resolved yet
 * and the order is still UNFINISHED, so the host must KEEP the local cart in
 * sync with the still-live backend cart (clearing it early lets a subsequent
 * "add to cart" silently reuse the same un-finalized order). `failed` /
 * `canceled` / `expired` also return false so the shopper can retry.
 *
 * Note: this is the CLIENT/return-page rule and is intentionally distinct from
 * the WEBHOOK's `deleteCart` in `statusLadder.ts`, which is a faithful port of
 * the WordPress plugin and clears the *backend* cart on open/pending too.
 *
 * Exported for testing and for hosts that want the same rule without a network
 * round-trip.
 */
export function isSettledStatus(status: string): boolean {
  const s = (status || '').toLowerCase();
  return s === 'paid' || s === 'authorized';
}
