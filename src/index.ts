/**
 * @propeller-commerce/propeller-v2-mollie
 *
 * Mollie PSP payment provider for the Propeller eCommerce V2 platform.
 * Server-side, framework-agnostic. The host owns the HTTP layer and injects a
 * configured Propeller SDK `GraphQLClient`.
 */

export { MollieProvider, isSettledStatus } from './MollieProvider';

// Public types
export type {
  MollieProviderConfig,
  MollieProviderHost,
  CreatePaymentArgs,
  CreatePaymentResult,
  HandleWebhookResult,
  MolliePaymentStatus,
  PaymentStatusResult,
} from './types';

// Logger
export type { Logger, LogLevel } from './logger';
export { consoleLogger, noopLogger } from './logger';

// Order status names (string consts). Payment/transaction enums are the SDK's —
// re-exported here for convenience so consumers don't need a second import.
export { OrderStatus } from './enums';
export type { OrderStatusValue } from './enums';
export {
  PaymentStatuses,
  TransactionTypes,
  TransactionStatuses,
} from '@propeller-commerce/propeller-sdk-v2';

// Pure helpers — exported for advanced hosts / testing.
export { resolveMollieMethod } from './mollie/methodMap';
export type { MollieMethod } from './mollie/methodMap';
export { classifyPayment } from './mollie/statusLadder';
export type { MolliePaymentSnapshot, PropellerStatusOutcome } from './mollie/statusLadder';
export { toCents, toMollieValue } from './propeller/amounts';
