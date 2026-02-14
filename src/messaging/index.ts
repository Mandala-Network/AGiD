/**
 * Messaging Module
 *
 * Exports for the AGIdentity P2P messaging system.
 */

export { AGIDMessageClient, createMessageClient } from './message-client.js';
export type {
  AGIDMessageConfig,
  AGIDMessage,
  AGIDPayment,
  AGIDPermission,
  AGIDQuote,
  MessageHandler,
  PaymentHandler,
} from './message-client.js';
