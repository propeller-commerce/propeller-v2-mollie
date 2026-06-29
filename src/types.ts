/**
 * Public types for the Mollie provider.
 */

import type { GraphQLClient } from '@propeller-commerce/propeller-sdk-v2';
import type { Logger } from './logger';

/**
 * The three PSP inputs — the headline constructor argument.
 *
 * The active key is selected by `testMode`: `key = testMode ? testApiKey : liveApiKey`.
 */
export interface MollieProviderConfig {
  /** Mollie LIVE API key (`live_...`). Used when `testMode` is false. */
  liveApiKey: string;
  /** Mollie TEST API key (`test_...`). Used when `testMode` is true. */
  testApiKey: string;
  /** When true, the test key is used; when false, the live key. */
  testMode: boolean;
}

/**
 * Host wiring — everything the package needs that isn't a PSP secret.
 *
 * The host injects a ready-configured SDK `GraphQLClient`. IMPORTANT: that
 * client must be built with `orderEditorApiKey` set (and `securityMode:
 * 'direct'` for server-to-server use), or the order-status mutations
 * (`orderSetStatus`, `triggerOrderSendConfirm`) will auth-fail — see README.
 */
export interface MollieProviderHost {
  /** A configured Propeller SDK GraphQL client (host-owned, server-side). */
  client: GraphQLClient;
  /**
   * Public URL Mollie will POST webhooks to. Mollie calls this with `{ id }`
   * after a payment changes state. Must be reachable from the public internet
   * (Mollie cannot reach `localhost`).
   */
  webhookUrl: string;
  /** Optional logger. Defaults to a `console`-backed logger. */
  logger?: Logger;
}

/** Arguments to start a payment at checkout. */
export interface CreatePaymentArgs {
  /** Propeller order id this payment is for. */
  orderId: number;
  /** Amount in MAJOR units (e.g. `10` or `"10.00"` for ten euros). */
  amount: string | number;
  /** ISO 4217 currency code, e.g. `"EUR"`. */
  currency: string;
  /** Propeller payment-method code (mapped to a Mollie method). */
  method: string;
  /** Human-readable description shown to the shopper / in Mollie. */
  description: string;
  /** Where Mollie returns the shopper after the payment flow (your thank-you / status page). */
  redirectUrl: string;
  /** Logged-in user id, if any. One of `userId` / `anonymousId` should be set. */
  userId?: number;
  /** Guest user id, if any. */
  anonymousId?: number;
}

/** Result of `createPayment`. */
export interface CreatePaymentResult {
  /** Mollie hosted checkout URL — redirect the shopper here. */
  checkoutUrl: string;
  /** Mollie payment id (`tr_...`). */
  paymentId: string;
  /** The Propeller order id. */
  orderId: number;
}

/**
 * Canonical Mollie payment status values. A redirected shopper's payment is in
 * one of these states when they land back on the return URL.
 * @see https://docs.mollie.com/payments/status-changes
 */
export type MolliePaymentStatus =
  | 'open'
  | 'pending'
  | 'authorized'
  | 'paid'
  | 'canceled'
  | 'expired'
  | 'failed';

/** Result of `getPaymentStatus`. */
export interface PaymentStatusResult {
  /** Whether the Mollie payment was found / fetched successfully. */
  ok: boolean;
  /** Mollie payment id queried. */
  paymentId: string;
  /** The live Mollie payment status (e.g. 'paid', 'failed'), if fetched. */
  status?: MolliePaymentStatus;
  /** Local-cart hint for the return page: true only for a captured payment
   *  (`paid`/`authorized`) → clear the cart. False for `open`/`pending` (not
   *  resolved yet → keep the cart) and `failed`/`canceled`/`expired` (keep it
   *  for a retry). See `isSettledStatus`. */
  settled?: boolean;
  /** Propeller order id from the payment metadata, if present. */
  orderId?: number;
  /** Populated when `ok` is false. */
  error?: string;
}

/** Result of `handleWebhook`. Always resolves; never throws out of the webhook. */
export interface HandleWebhookResult {
  /** Whether the payment was found, classified, and Propeller updated. */
  ok: boolean;
  /** Mollie payment id processed. */
  paymentId: string;
  /** Propeller order id resolved from the payment metadata, if available. */
  orderId?: number;
  /** Mollie payment status string at processing time, if fetched. */
  mollieStatus?: string;
  /** Populated when `ok` is false. */
  error?: string;
}
