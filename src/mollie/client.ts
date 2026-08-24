/**
 * Thin seam over the official `@mollie/api-client`.
 *
 * Responsibilities:
 *  - select the right API key (test vs live) from the 3 PSP inputs;
 *  - create a Mollie payment (checkout) and surface its checkout URL;
 *  - fetch a payment and reduce it to the version-stable snapshot the status
 *    ladder consumes.
 *
 * A fresh Mollie client is created per provider instance (cheap). We resolve the
 * key once at construction from `testMode`.
 */

// Named import (not default). `@mollie/api-client` is a CommonJS package whose
// default export is the `createMollieClient` function. Under a bundler (e.g.
// Next.js) a default import is normalized correctly, but under raw Node ESM the
// CJS→ESM interop binds the default to the whole `module.exports` object, so
// `createMollieClient(...)` throws "is not a function". The package also exports
// `createMollieClient` as a NAMED export, which survives the interop intact — so
// import it by name to work in both bundled and native-ESM hosts (the Node SSR
// server in propeller-vue is the latter).
import { createMollieClient, type MollieClient, PaymentMethod } from '@mollie/api-client';
import type { MollieProviderConfig } from '../types';
import type { MollieMethod } from './methodMap';
import type { MolliePaymentSnapshot } from './statusLadder';

/** Parameters for creating a Mollie payment. */
export interface MolliePaymentCreateParams {
  /** Major-unit decimal string, e.g. "10.00". */
  value: string;
  /** ISO 4217 currency, e.g. "EUR". */
  currency: string;
  description: string;
  redirectUrl: string;
  webhookUrl: string;
  /** Resolved Mollie method. */
  method: MollieMethod;
  /** Propeller order id, stored in metadata so the webhook can recover it. */
  orderId: number;
}

/** What we extract from a freshly created Mollie payment. */
export interface MolliePaymentCreated {
  paymentId: string;
  checkoutUrl: string | null;
}

/** Resolve the active Mollie API key from the 3 PSP inputs. */
export function resolveApiKey(config: MollieProviderConfig): string {
  return config.testMode ? config.testApiKey : config.liveApiKey;
}

/**
 * A small wrapper holding a configured Mollie client. Keeps the raw client
 * accessible for advanced use, but exposes the two operations we need.
 */
export class MollieGateway {
  private readonly client: MollieClient;

  constructor(config: MollieProviderConfig) {
    const apiKey = resolveApiKey(config);
    if (!apiKey) {
      throw new Error(
        `Mollie API key missing: ${config.testMode ? 'testApiKey' : 'liveApiKey'} is empty (testMode=${config.testMode}).`
      );
    }
    this.client = createMollieClient({ apiKey });
  }

  /** Create a Mollie payment and return its id + checkout URL. */
  async createPayment(params: MolliePaymentCreateParams): Promise<MolliePaymentCreated> {
    // Our MollieMethod string-literals are a subset of Mollie's PaymentMethod
    // string enum (identical values), so this cast is safe.
    const payment = await this.client.payments.create({
      amount: { currency: params.currency, value: params.value },
      description: params.description,
      redirectUrl: params.redirectUrl,
      webhookUrl: params.webhookUrl,
      method: params.method as PaymentMethod,
      metadata: { order_id: params.orderId },
    });

    return {
      paymentId: payment.id,
      checkoutUrl: payment.getCheckoutUrl(),
    };
  }

  /**
   * Fetch a payment by id and reduce it to the snapshot the status ladder uses,
   * plus the fields the Propeller update needs (authoritative amount, currency,
   * and order id from metadata).
   */
  async getPaymentSnapshot(paymentId: string): Promise<{
    snapshot: MolliePaymentSnapshot;
    amount: string;
    currency: string;
    orderId: number | undefined;
    method: string | undefined;
  }> {
    const payment = await this.client.payments.get(paymentId);

    const metadata = (payment.metadata ?? {}) as Record<string, unknown>;
    const rawOrderId = metadata.order_id;
    const orderId =
      typeof rawOrderId === 'number'
        ? rawOrderId
        : rawOrderId != null && !Number.isNaN(Number(rawOrderId))
        ? Number(rawOrderId)
        : undefined;

    return {
      snapshot: {
        status: payment.status,
        hasRefunds: payment.hasRefunds(),
        hasChargebacks: payment.hasChargebacks(),
      },
      amount: payment.amount.value,
      currency: payment.amount.currency,
      orderId,
      method: typeof payment.method === 'string' ? payment.method : undefined,
    };
  }
}
