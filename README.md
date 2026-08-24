# @propeller-commerce/propeller-v2-mollie

Mollie PSP payment provider for the **Propeller eCommerce V2** platform. Drives
Mollie payments through the Propeller GraphQL API via
[`@propeller-commerce/propeller-sdk-v2`](https://www.npmjs.com/package/@propeller-commerce/propeller-sdk-v2).

This is a **server-side, framework-agnostic** library: it creates Mollie
payments, persists them in Propeller, reconciles order/payment state from the
Mollie webhook, and exposes a live status lookup for the return page. The
**host** owns the HTTP layer (the checkout route, the webhook route, and the
return/thank-you page).

> ⚠️ **Server-only.** This package handles secret Mollie API keys and issues
> privileged Propeller mutations. Never bundle it into browser code.

## Install

```bash
npm install @propeller-commerce/propeller-v2-mollie @propeller-commerce/propeller-sdk-v2
```

`@propeller-commerce/propeller-sdk-v2` is a **peer dependency** — the host
provides the configured GraphQL client.

## The three inputs

```ts
new MollieProvider(
  { liveApiKey, testApiKey, testMode },  // ← the 3 PSP inputs
  { client, webhookUrl, logger? }        // ← host wiring
);
```

| Input | Meaning |
|---|---|
| `liveApiKey` | Mollie **live** API key (`live_…`). Used when `testMode` is `false`. |
| `testApiKey` | Mollie **test** API key (`test_…`). Used when `testMode` is `true`. |
| `testMode` | `true` → test key, `false` → live key. |

## Host wiring (`client`, `webhookUrl`, `logger`)

The package does **not** build a Propeller client and holds **no** Propeller
credentials — you inject a configured SDK `GraphQLClient`.

```ts
import { GraphQLClient } from '@propeller-commerce/propeller-sdk-v2';

const client = new GraphQLClient({
  endpoint: process.env.PROPELLER_GRAPHQL_ENDPOINT!,
  apiKey: process.env.PROPELLER_API_KEY!,
  orderEditorApiKey: process.env.PROPELLER_ORDER_EDITOR_API_KEY!, // ← REQUIRED, see below
  securityMode: 'direct',
});
```

> ### ❗ You MUST set `orderEditorApiKey`
> In `direct` mode the SDK routes order-editor mutations — **`orderSetStatus`**
> and **`triggerOrderSendConfirm`** — to the `orderEditorApiKey` header instead
> of `apiKey`. This package updates order status on every webhook, so **without
> `orderEditorApiKey` the order-status update silently auth-fails** while the
> payment update appears to succeed. Always supply it.

`webhookUrl` is the **public** URL Mollie will POST to (Mollie cannot reach
`localhost`; use a tunnel like cloudflared or ngrok in development). `logger` is
optional and defaults to a `console`-backed logger.

## Usage

### 1. Start a payment (checkout)

Creates the Mollie payment **and** the Propeller payment (status `OPEN` + an
`AUTHORIZATION` transaction), then returns the Mollie checkout URL.

```ts
import { MollieProvider } from '@propeller-commerce/propeller-v2-mollie';

const provider = new MollieProvider(
  {
    liveApiKey: process.env.MOLLIE_LIVE_KEY!,
    testApiKey: process.env.MOLLIE_TEST_KEY!,
    testMode: process.env.MOLLIE_TEST_MODE === 'true',
  },
  { client, webhookUrl: `${process.env.PUBLIC_BASE_URL}/api/mollie/webhook` }
);

const { checkoutUrl, paymentId } = await provider.createPayment({
  orderId: 12345,
  amount: '49.95',         // major units (number or decimal string)
  currency: 'EUR',
  method: 'ideal',         // Propeller method code → mapped to a Mollie method
  description: 'Order #12345',
  redirectUrl: `${process.env.PUBLIC_BASE_URL}/checkout/thank-you/12345`,
  userId: 678,             // or anonymousId for guests
});

// Redirect the shopper to `checkoutUrl`.
```

### 2. Handle the webhook

Mollie POSTs only `{ id }`. Pass that id to `handleWebhook`; it re-fetches the
payment from Mollie (the body is never trusted beyond the id), classifies it,
and updates the Propeller payment + order. **It never throws** — always return
`200` to Mollie so it doesn't enter a retry loop.

#### Next.js (App Router route handler)

```ts
// app/api/mollie/webhook/route.ts
import { NextResponse } from 'next/server';
import { provider } from '@/lib/mollie'; // your singleton MollieProvider

export async function POST(req: Request) {
  const body = new URLSearchParams(await req.text()); // Mollie posts form-encoded
  const id = body.get('id') ?? '';
  await provider.handleWebhook(id);     // result is logged internally
  return new NextResponse(null, { status: 200 }); // always 200
}
```

#### Express

```ts
import express from 'express';
import { provider } from './mollie';

const app = express();
app.use(express.urlencoded({ extended: false })); // Mollie posts form-encoded

app.post('/api/mollie/webhook', async (req, res) => {
  await provider.handleWebhook(req.body.id ?? '');
  res.sendStatus(200); // always 200
});
```

### 3. Resolve the outcome on the return page

Mollie redirects the shopper back to your `redirectUrl` **for every outcome** —
paid, open, failed, canceled, expired all land on the same URL — and the webhook
that finalizes the order is asynchronous, so it may not have arrived yet. The
order status alone therefore can't tell `open` from `failed` (both are
`UNFINISHED`). Ask Mollie directly with `getPaymentStatus`:

```ts
const result = await provider.getPaymentStatus(paymentId);
// { ok, paymentId, status?, settled?, orderId? }
```

It is **read-only** (never touches Propeller) and always resolves. Use it to
pick the return-page UI and decide the **local cart** action:

| Mollie `status` | `settled` | Return-page UI | Local cart |
|---|---|---|---|
| `paid` / `authorized` | `true` | Success | **clear it** |
| `open` / `pending` | `false` | "Payment still open" + re-check | **keep it** |
| `failed` / `canceled` / `expired` | `false` | Failure + retry | **keep it** |

`settled` is the cart hint: clear the local cart **only** for a captured payment
(`paid`/`authorized`). An `open`/`pending` payment isn't finalized yet, so
keeping the local cart leaves it in sync with the still-live backend cart;
clearing it early would let a subsequent "add to cart" silently reuse the same
un-finalized order. The same rule is exported as a pure helper:

```ts
import { isSettledStatus } from '@propeller-commerce/propeller-v2-mollie';
isSettledStatus('paid');   // true  → clear the local cart
isSettledStatus('open');   // false → keep it
isSettledStatus('failed'); // false → keep it
```

> **Two distinct cart rules.** `isSettledStatus` / `getPaymentStatus().settled`
> is the **client / return-page** rule for the shopper's **local** cart. The
> webhook's "clears cart" column below is a **separate, server-side** rule for
> the **backend** cart — it intentionally clears on `open`/`pending` too. Don't
> conflate them.

## Status mapping (webhook → Propeller)

The webhook classifies the Mollie payment and pushes this status tuple to
Propeller:

| Mollie state | txn type | txn status | payment status | order status | clears cart |
|---|---|---|---|---|---|
| paid (no refund/chargeback) | PAY | SUCCESS | PAID | NEW | ✔ |
| open | PAY | OPEN | OPEN | UNFINISHED | ✔ |
| pending | PAY | PENDING | PENDING | UNFINISHED | ✔ |
| failed | PAY | FAILED | FAILED | UNFINISHED | ✗ |
| expired | PAY | FAILED | EXPIRED | UNFINISHED | ✗ |
| canceled | PAY | FAILED | CANCELLED | UNFINISHED | ✗ |
| has refunds | REFUND | SUCCESS | PAID | NEW | ✔ |
| has chargebacks | CHARGEBACK | SUCCESS | CHARGEBACK | NEW | ✔ |

On the "clears cart" rows the package also sends the order confirmation email,
fires the confirm event, and attaches the order PDF — via a single
`orderSetStatus` mutation. Amounts are converted from Mollie's decimal string to
Propeller's integer **cents**; the webhook uses Mollie's authoritative amount.

This "clears cart" column is the **server-side / backend** cart and is separate
from the **local** cart rule the return page uses (`isSettledStatus` — see
[step 3](#3-resolve-the-outcome-on-the-return-page)), which keeps the local cart
on `open`/`pending`.

## Public API

| Export | Description |
|---|---|
| `MollieProvider` | The provider class — `createPayment`, `handleWebhook`, `getPaymentStatus`. |
| `isSettledStatus` | Pure helper — `true` only for `paid`/`authorized` (the local-cart rule). |
| `MollieProviderConfig`, `MollieProviderHost`, `CreatePaymentArgs`, `CreatePaymentResult`, `HandleWebhookResult`, `MolliePaymentStatus`, `PaymentStatusResult` | Types. |
| `OrderStatus` | Propeller order-status string consts. |
| `PaymentStatuses`, `TransactionTypes`, `TransactionStatuses` | Re-exported SDK enums. |
| `resolveMollieMethod`, `classifyPayment`, `toCents`, `toMollieValue` | Pure helpers (advanced / testing). |
| `consoleLogger`, `noopLogger`, `Logger`, `LogLevel` | Logging. |

## Notes & limitations (v1)

- **Refund/chargeback initiation** is out of scope — the package only *reacts*
  to Mollie's refund/chargeback webhooks.
- Uses the Mollie **Payments API** (not the Orders API).
- Webhook **idempotency**: Mollie may re-deliver. Payment update by `paymentId`
  is idempotent for status; transactions are keyed by `transactionId` (the
  Mollie payment id) — confirm your backend dedups appended transactions if
  re-delivery matters to you.

## License

MIT
