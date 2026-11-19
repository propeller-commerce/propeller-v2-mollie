/**
 * handleWebhook ties the Mollie payment to the Propeller order (review #19):
 * nothing changes unless Mollie's amount + currency pay the order's total.
 * Runs a real SDK GraphQLClient against a stubbed `fetch`, so the key routing
 * of the order lookup is exercised too.
 */
import { GraphQLClient } from '@propeller-commerce/propeller-sdk-v2';
import { MollieProvider } from '../src/MollieProvider';
import { noopLogger } from '../src/logger';
import { matchesOrderTotal } from '../src/propeller/amounts';
import { ORDER_TOTAL_OPERATION, routeOrderLookupToOrderEditorKey } from '../src/propeller/orders';

const snapshot = {
  snapshot: { status: 'paid', hasRefunds: false, hasChargebacks: false },
  amount: '2000.00',
  currency: 'EUR',
  orderId: 42 as number | undefined,
  method: 'ideal',
};

jest.mock('../src/mollie/client', () => ({
  MollieGateway: jest.fn().mockImplementation(() => ({
    getPaymentSnapshot: jest.fn(async () => snapshot),
  })),
}));

type Order = {
  id: number;
  status: string;
  currency: string;
  total: { net: number };
  paymentData: { status: string };
} | null;
type Call = { operationName: string; variables: Record<string, any>; apikey: string };

let order: Order;
let calls: Call[];

beforeEach(() => {
  snapshot.snapshot = { status: 'paid', hasRefunds: false, hasChargebacks: false };
  snapshot.amount = '2000.00';
  snapshot.currency = 'EUR';
  snapshot.orderId = 42;
  order = placedOrder('UNFINISHED', 'OPEN');
  calls = [];
  jest.spyOn(global, 'fetch').mockImplementation(async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    const apikey = (init?.headers as Record<string, string>).apikey;
    calls.push({ operationName: body.operationName, variables: body.variables, apikey });
    if (body.operationName === 'orderSetStatus' && order) {
      // Apply the write, so a replay sees the order as Propeller would return it.
      order.status = body.variables.input.status;
      order.paymentData.status = body.variables.input.payStatus;
    }
    const data =
      body.operationName === ORDER_TOTAL_OPERATION
        ? order
          ? { order }
          : null
        : { [body.operationName]: { id: 1 } };
    const errors = data ? undefined : [{ message: 'Cannot find order with id 42' }];
    return new Response(JSON.stringify({ data, errors }), { status: 200 });
  });
});

function placedOrder(status: string, payStatus: string): Order {
  return { id: 42, status, currency: 'EUR', total: { net: 2000 }, paymentData: { status: payStatus } };
}

function provider(
  orderEditorMutations: string[] | undefined = ['orderSetStatus', 'paymentCreate', 'paymentUpdate']
): MollieProvider {
  const client = new GraphQLClient({
    endpoint: 'https://propeller.test/graphql',
    apiKey: 'storefront-key',
    orderEditorApiKey: 'order-editor-key',
    securityMode: 'direct',
    orderEditorMutations,
  });
  return new MollieProvider(
    { liveApiKey: 'live_x', testApiKey: 'test_x', testMode: true },
    { client, webhookUrl: 'https://shop.test/api/mollie/webhook', logger: noopLogger }
  );
}

const writes = () => calls.filter((c) => c.operationName !== ORDER_TOTAL_OPERATION);
const setStatus = () => calls.find((c) => c.operationName === 'orderSetStatus');

describe('handleWebhook — payment must pay the order total', () => {
  it('matching amount + currency: PAID / NEW with confirmation, lookup under the order-editor key', async () => {
    const res = await provider().handleWebhook('tr_1');
    expect(res.ok).toBe(true);
    const lookup = calls.find((c) => c.operationName === ORDER_TOTAL_OPERATION)!;
    expect(lookup.variables).toEqual({ orderId: 42 });
    expect(lookup.apikey).toBe('order-editor-key');
    expect(setStatus()!.variables.input).toMatchObject({
      orderId: 42,
      status: 'NEW',
      payStatus: 'PAID',
      sendOrderConfirmationEmail: true,
      deleteCart: true,
    });
  });

  it('client on the SDK default key list: lookup and orderSetStatus still use the order-editor key', async () => {
    await provider(undefined).handleWebhook('tr_1');
    expect(calls.find((c) => c.operationName === ORDER_TOTAL_OPERATION)!.apikey).toBe('order-editor-key');
    expect(setStatus()!.apikey).toBe('order-editor-key');
  });

  it('amount below the total: nothing written', async () => {
    snapshot.amount = '0.01';
    const res = await provider().handleWebhook('tr_1');
    expect(res).toMatchObject({ ok: false, orderId: 42, error: 'amount does not match the order total' });
    expect(writes()).toEqual([]);
  });

  it('open payment of a foreign amount does not clear the cart', async () => {
    snapshot.snapshot.status = 'open';
    snapshot.amount = '5.00';
    const res = await provider().handleWebhook('tr_1');
    expect(res.ok).toBe(false);
    expect(writes()).toEqual([]);
  });

  it('currency mismatch: nothing written', async () => {
    snapshot.currency = 'USD';
    const res = await provider().handleWebhook('tr_1');
    expect(res).toMatchObject({ ok: false, error: 'amount does not match the order total' });
    expect(writes()).toEqual([]);
  });

  it('missing order: nothing written', async () => {
    order = null;
    const res = await provider().handleWebhook('tr_1');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Cannot find order/);
    expect(writes()).toEqual([]);
  });

  it('placed but unpaid order (NEW, OPEN): paid is written, no second confirmation or cart deletion', async () => {
    order = placedOrder('NEW', 'OPEN');
    const res = await provider().handleWebhook('tr_1');
    expect(res.ok).toBe(true);
    expect(setStatus()!.variables.input).toMatchObject({
      status: 'NEW',
      payStatus: 'PAID',
      sendOrderConfirmationEmail: false,
      addPDFAttachment: false,
      triggerOrderSendConfirmEvent: false,
      deleteCart: false,
    });
  });
});

describe('handleWebhook — a placed order is never moved back', () => {
  beforeEach(() => {
    order = placedOrder('NEW', 'PAID');
  });

  it.each(['canceled', 'expired', 'failed', 'open', 'pending'])(
    '%s payment of the order total on a NEW + PAID order: nothing written',
    async (status) => {
      snapshot.snapshot.status = status;
      const res = await provider().handleWebhook('tr_2');
      expect(res).toMatchObject({ ok: false, orderId: 42, error: `order is already NEW; ${status} payment ignored` });
      expect(writes()).toEqual([]);
    }
  );

  it('expired payment on a later-stage order (CONFIRMED): nothing written', async () => {
    order = placedOrder('CONFIRMED', 'PAID');
    snapshot.snapshot.status = 'expired';
    await provider().handleWebhook('tr_2');
    expect(writes()).toEqual([]);
  });

  it('paid replay on a PAID order: nothing re-sent or re-written', async () => {
    const res = await provider().handleWebhook('tr_1');
    expect(res).toMatchObject({ ok: true, orderId: 42 });
    expect(writes()).toEqual([]);
  });

  // Unchanged: a refund appends a REFUND transaction and keeps NEW / PAID; a
  // chargeback appends a CHARGEBACK transaction and sets pay status CHARGEBACK.
  // Neither re-sends the confirmation or touches the cart of a placed order.
  it('refund on a NEW + PAID order: REFUND transaction, order NEW / PAID, no confirmation', async () => {
    snapshot.snapshot.hasRefunds = true;
    const res = await provider().handleWebhook('tr_1');
    expect(res.ok).toBe(true);
    const payment = writes().find((c) => c.operationName !== 'orderSetStatus')!;
    expect(payment.variables.input.addTransaction).toMatchObject({ type: 'REFUND', status: 'SUCCESS' });
    expect(setStatus()!.variables.input).toMatchObject({
      status: 'NEW',
      payStatus: 'PAID',
      sendOrderConfirmationEmail: false,
      deleteCart: false,
    });
  });

  it('chargeback on a NEW + PAID order: CHARGEBACK transaction, pay status CHARGEBACK, no confirmation', async () => {
    snapshot.snapshot.hasChargebacks = true;
    const res = await provider().handleWebhook('tr_1');
    expect(res.ok).toBe(true);
    const payment = writes().find((c) => c.operationName !== 'orderSetStatus')!;
    expect(payment.variables.input.addTransaction).toMatchObject({ type: 'CHARGEBACK', status: 'SUCCESS' });
    expect(setStatus()!.variables.input).toMatchObject({
      status: 'NEW',
      payStatus: 'CHARGEBACK',
      sendOrderConfirmationEmail: false,
      deleteCart: false,
    });
  });
});

describe('handleWebhook — only paid, refund and chargeback fulfil, once per order', () => {
  // The orderSetStatus writes that sent the confirmation, as "status/payStatus".
  const fulfilled = () =>
    calls
      .filter((c) => c.operationName === 'orderSetStatus' && c.variables.input.sendOrderConfirmationEmail)
      .map((c) => `${c.variables.input.status}/${c.variables.input.payStatus}`);

  // Two payments for one order, their webhooks delivered alternately.
  async function deliver(statuses: string[], payStatus: string): Promise<void> {
    order = placedOrder('UNFINISHED', payStatus);
    const p = provider();
    for (let i = 0; i < statuses.length; i++) {
      snapshot.snapshot.status = statuses[i];
      await p.handleWebhook(i % 2 ? 'tr_2' : 'tr_1');
    }
  }

  it.each(['open,canceled,open,canceled,open,canceled,open', 'open,pending,open,pending,open'])(
    '%s from UNFINISHED / OPEN: no fulfil',
    async (sequence) => {
      await deliver(sequence.split(','), 'OPEN');
      expect(fulfilled()).toEqual([]);
      expect(order!.status).toBe('UNFINISHED');
    }
  );

  it.each(['OPEN', ''])('open,paid,open,paid,canceled from UNFINISHED / "%s": paid fulfils once, ends NEW / PAID', async (payStatus) => {
    await deliver(['open', 'paid', 'open', 'paid', 'canceled'], payStatus);
    expect(fulfilled()).toEqual(['NEW/PAID']);
    expect(order).toMatchObject({ status: 'NEW', paymentData: { status: 'PAID' } });
  });

  it.each(['open', 'pending'])('3x %s then 2x paid: only paid fulfils', async (status) => {
    await deliver([status, status, status, 'paid', 'paid'], '');
    expect(fulfilled()).toEqual(['NEW/PAID']);
  });

  it('open on an order already OPEN: status written, no fulfil', async () => {
    snapshot.snapshot.status = 'open';
    await provider().handleWebhook('tr_1');
    expect(setStatus()!.variables.input).toMatchObject({ status: 'UNFINISHED', payStatus: 'OPEN', deleteCart: false });
  });
});

describe('routeOrderLookupToOrderEditorKey', () => {
  it('fallback for a client without orderEditorMutations never adds passwordResetLink', async () => {
    const client = new GraphQLClient({
      endpoint: 'https://propeller.test/graphql',
      apiKey: 'storefront-key',
      orderEditorApiKey: 'order-editor-key',
      securityMode: 'direct',
    });
    routeOrderLookupToOrderEditorKey(client);
    expect(client.getConfig().orderEditorMutations).toEqual([
      'orderSetStatus',
      'triggerQuoteSendRequest',
      'triggerOrderSendConfirm',
      ORDER_TOTAL_OPERATION,
    ]);
    await client.execute({ query: 'mutation passwordResetLink { x }', operationName: 'passwordResetLink' });
    expect(calls.find((c) => c.operationName === 'passwordResetLink')!.apikey).toBe('storefront-key');
  });
});

describe('matchesOrderTotal', () => {
  it('whole-cent totals must match exactly', () => {
    expect(matchesOrderTotal(1107, 'EUR', 11.07, 'EUR')).toBe(true);
    expect(matchesOrderTotal(1108, 'EUR', 11.07, 'EUR')).toBe(false);
    expect(matchesOrderTotal(1106, 'EUR', 11.07, 'EUR')).toBe(false);
  });

  it('sub-cent totals (Propeller keeps four decimals) match either neighbouring cent', () => {
    expect(matchesOrderTotal(1339, 'EUR', 13.3947, 'EUR')).toBe(true);
    expect(matchesOrderTotal(1340, 'EUR', 13.3947, 'EUR')).toBe(true);
    expect(matchesOrderTotal(1338, 'EUR', 13.3947, 'EUR')).toBe(false);
    expect(matchesOrderTotal(111, 'EUR', 1.115, 'EUR')).toBe(true);
    expect(matchesOrderTotal(112, 'EUR', 1.115, 'EUR')).toBe(true);
  });

  it('the ex-VAT total does not pay the order', () => {
    // order 13.3947 incl. VAT = 11.07 ex VAT
    expect(matchesOrderTotal(1107, 'EUR', 13.3947, 'EUR')).toBe(false);
  });

  it('currency compare ignores case, rejects a different or empty currency', () => {
    expect(matchesOrderTotal(1107, 'eur', 11.07, 'EUR')).toBe(true);
    expect(matchesOrderTotal(1107, 'USD', 11.07, 'EUR')).toBe(false);
    expect(matchesOrderTotal(1107, '', 11.07, '')).toBe(false);
  });

  it('rejects non-integer cents and non-finite totals', () => {
    expect(matchesOrderTotal(1107.5, 'EUR', 11.075, 'EUR')).toBe(false);
    expect(matchesOrderTotal(1107, 'EUR', NaN, 'EUR')).toBe(false);
  });
});
