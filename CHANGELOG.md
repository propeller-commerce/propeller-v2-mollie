# Changelog

All notable changes to `@propeller-commerce/propeller-v2-mollie` are documented
here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project aims to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
once it reaches 1.0. Until then (the `0.x` line) the public API may change
between minor versions.

## [0.2.3] - 2026-07-08

### Changed

- Bumped the `@propeller-commerce/propeller-sdk-v2` peer/dev dependency to
  `^0.12.0`. No API change — tracks the SDK's 0.12.0 release.

## [0.2.2] - 2026-06-29

### Fixed

- **`createMollieClient` import now works under native Node ESM.** The ESM build
  imported the Mollie client via a default import
  (`import createMollieClient from '@mollie/api-client'`). `@mollie/api-client`
  is CommonJS, so under raw Node ESM the CJS→ESM interop binds the default to the
  whole `module.exports` object rather than the function — `createMollieClient(…)`
  then threw `createMollieClient is not a function` at payment-create / webhook /
  status-lookup time. Bundled hosts (e.g. Next.js) normalize the interop and
  never hit this; a native-ESM host (a Node SSR server such as propeller-vue's
  `server.js`) does. Switched to the equivalent **named** import
  (`import { createMollieClient } from '@mollie/api-client'`), which the package
  also exports and which survives the interop intact — fixing native-ESM hosts
  without affecting bundled ones. No API change.

## [0.2.1] - 2026-06-26

### Changed

- **`isSettledStatus` now means "captured → clear the LOCAL cart" and returns
  true only for `paid` / `authorized`.** Previously it also returned true for
  `open` / `pending`, which wrongly cleared the shopper's local cart on the
  return page while the payment was still unresolved and the order still
  UNFINISHED — a subsequent "add to cart" then silently reused the same
  un-finalized order. `open` / `pending` now keep the cart (return false), in
  sync with the still-live backend cart, until the payment actually resolves.
  This is the client/return-page rule and is intentionally distinct from the
  webhook's `deleteCart` in `statusLadder.ts` (a faithful port of the WordPress
  plugin that clears the *backend* cart on open/pending too — unchanged).
- `getPaymentStatus().settled` follows the same corrected rule.

## [0.2.0] - 2026-06-26

### Added

- **`MollieProvider.getPaymentStatus(paymentId)`** — read-only live Mollie
  status lookup for the return page. Returns the canonical status (`open` /
  `paid` / `failed` / `canceled` / `expired` / …), a `settled` cart-deletion
  hint, and the order id. Does NOT touch Propeller; always resolves.
- **`isSettledStatus(status)`** helper + `MolliePaymentStatus` /
  `PaymentStatusResult` types, exported. `settled` is true for
  `open`/`pending`/`authorized`/`paid` (clear the cart) and false for
  `failed`/`canceled`/`expired` (keep it for a retry).

## [0.1.0] - 2026-06-26

Initial scaffold — a TypeScript port of the Propeller WordPress Mollie plugin as
a standalone, framework-agnostic, server-side package.

### Added

- **`MollieProvider`** with two operations:
  - `createPayment(args)` — creates a Mollie payment + a Propeller payment
    (status `OPEN` with an `AUTHORIZATION` transaction) and returns the Mollie
    checkout URL.
  - `handleWebhook(molliePaymentId)` — re-fetches the payment from Mollie,
    classifies it, and updates the Propeller payment + order. Never throws (the
    host always returns 200).
- **Three PSP inputs**: `{ liveApiKey, testApiKey, testMode }`; the active key is
  selected by `testMode`.
- **Host wiring** via an injected SDK `GraphQLClient` (no Propeller credentials
  held here) + `webhookUrl` + optional `logger`.
- **Webhook status ladder** (`classifyPayment`) — faithful port of the plugin's
  paid/open/pending/failed/expired/canceled/refund/chargeback branches.
- **Propeller seams** over the SDK service factories: `paymentService`
  (create/update with inline `addTransaction`) and `orderService.setOrderStatus`
  (one mutation consolidating status, payStatus, PDF, confirmation email, event,
  and cart deletion).
- **Mollie seam** over `@mollie/api-client` v4 (`payments.create` /
  `payments.get`, `getCheckoutUrl`, `hasRefunds`/`hasChargebacks`).
- Method mapping (`resolveMollieMethod`) and amount helpers (`toCents`,
  `toMollieValue`) with the float-rounding fix.
- Dual CJS + ESM build, `.d.ts` types, 22 unit tests (status ladder, amounts,
  method map).

### Known follow-ups (see `PLAN.md`)

- Validate that the single `orderSetStatus` reproduces the plugin's two-step
  `change_status` + `triggerOrderSendConfirm` against the live backend.
- Webhook idempotency on re-delivery (transaction dedup).
- Integration tests for `createPayment` / `handleWebhook` with mocked Mollie +
  SDK clients.
