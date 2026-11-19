/**
 * Propeller order status update via the SDK `orderService`.
 *
 * The WordPress plugin's `order_update` made TWO calls: `OrderController::change_status`
 * (status, payStatus, PDF, email, deleteCart) and then a separate
 * `triggerOrderSendConfirm`. The SDK consolidates ALL of this into a single
 * `orderSetStatus(OrderSetStatusInput)` mutation, whose input carries:
 *   - status, payStatus
 *   - addPDFAttachment
 *   - sendOrderConfirmationEmail
 *   - triggerOrderSendConfirmEvent
 *   - deleteCart
 *
 * So we issue ONE call. The plugin only sent the confirmation email + cleared
 * the cart on the "successful" branches (its `delete_cart` flag), so we gate the
 * email/event/PDF/deleteCart on that same flag.
 *
 * NOTE (validation item from PLAN.md §7.1): confirm this single mutation
 * reproduces the plugin's two-step behaviour against the live backend. If the
 * event must fire independently of the status change, expose a separate
 * trigger call.
 */

import {
  orderService,
  type GraphQLClient,
  type OrderSetStatusInput,
  type Order,
} from '@propeller-commerce/propeller-sdk-v2';
import type { OrderStatusValue } from '../enums';

export interface SetOrderStatusArgs {
  orderId: number;
  /** Propeller order status, e.g. NEW / UNFINISHED. */
  orderStatus: OrderStatusValue;
  /** Propeller pay status — the payment status string (e.g. PAID). */
  payStatus: string;
  /**
   * The plugin's `delete_cart` flag. When true we clear the cart AND send the
   * order confirmation (email + event) and attach the PDF — matching the
   * plugin's "successful payment" path.
   */
  fulfil: boolean;
}

/**
 * Set the order status (and, on the fulfil path, send confirmation + clear cart).
 * One `orderSetStatus` call replaces the plugin's change_status + trigger.
 */
export async function setPropellerOrderStatus(
  client: GraphQLClient,
  args: SetOrderStatusArgs
): Promise<Order> {
  const input: OrderSetStatusInput = {
    orderId: args.orderId,
    status: args.orderStatus,
    payStatus: args.payStatus,
    addPDFAttachment: args.fulfil,
    sendOrderConfirmationEmail: args.fulfil,
    triggerOrderSendConfirmEvent: args.fulfil,
    deleteCart: args.fulfil,
  };

  return orderService(client).setOrderStatus(input);
}

/** Operation name of the order lookup; routed to the order-editor key (see below). */
export const ORDER_TOTAL_OPERATION = 'propellerPspOrderTotal';

const ORDER_TOTAL_QUERY = `query ${ORDER_TOTAL_OPERATION}($orderId: Int!) {
  order(orderId: $orderId) { id status currency total { net } paymentData { status } }
}`;

// The SDK's built-in order-editor list, used when the host didn't set its own.
// Never `passwordResetLink`: it returns the reset link, so under the
// order-editor key anyone could get one for any account (the SDK dropped it
// from its default too).
const SDK_DEFAULT_ORDER_EDITOR_OPERATIONS: ReadonlyArray<string> = [
  'orderSetStatus',
  'triggerQuoteSendRequest',
  'triggerOrderSendConfirm',
];

/**
 * Send the order lookup with the order-editor key. The storefront key gets
 * "Forbidden resource" on `order(orderId)` without a Bearer, and the SDK picks
 * the key by operation name, so this adds the lookup's (package-unique) name to
 * the host client's order-editor list. Idempotent; nothing else changes.
 */
export function routeOrderLookupToOrderEditorKey(client: GraphQLClient): void {
  const names = client.getConfig().orderEditorMutations ?? SDK_DEFAULT_ORDER_EDITOR_OPERATIONS;
  if (!names.includes(ORDER_TOTAL_OPERATION)) {
    client.updateConfig({ orderEditorMutations: [...names, ORDER_TOTAL_OPERATION] });
  }
}

/** What the webhook needs from the Propeller order to tie a payment to it. */
export interface OrderTotalSnapshot {
  /** Propeller order status, e.g. UNFINISHED / NEW. */
  status: string;
  /** The order's pay status (`paymentData.status`), e.g. PAID; '' when unset. */
  payStatus: string;
  currency: string;
  /** `total.net`: the VAT-inclusive total the shopper pays (SDK naming is inverted). */
  total: number;
}

/**
 * Load the order's status, pay status, currency and VAT-inclusive total. Selects nothing
 * else (no addresses, no e-mail). Returns null when the order doesn't exist;
 * throws when the lookup itself fails, so the caller changes nothing.
 */
export async function fetchOrderTotal(
  client: GraphQLClient,
  orderId: number
): Promise<OrderTotalSnapshot | null> {
  const res = await client.execute<{
    order?: {
      status?: string;
      currency?: string;
      total?: { net?: number };
      paymentData?: { status?: string | null } | null;
    } | null;
  }>({ query: ORDER_TOTAL_QUERY, variables: { orderId }, operationName: ORDER_TOTAL_OPERATION });
  const order = res.data?.order;
  if (!order) {
    if (res.errors?.length) {
      throw new Error(`Propeller order lookup failed: ${res.errors[0]?.message ?? 'unknown error'}`);
    }
    return null;
  }
  const total = order.total?.net;
  if (typeof total !== 'number' || typeof order.currency !== 'string') return null;
  return {
    status: String(order.status ?? ''),
    payStatus: String(order.paymentData?.status ?? ''),
    currency: order.currency,
    total,
  };
}
