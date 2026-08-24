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
