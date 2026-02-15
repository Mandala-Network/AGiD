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

// Gated message handler with identity verification
export {
  GatedMessageHandler,
  CertificateExchangeMessageSchema,
  CERT_EXCHANGE_MESSAGEBOX,
} from './gated-message-handler.js';
export type {
  GatedMessageHandlerConfig,
  VerifiedMessage,
  VerifiedMessageHandler,
  CertificateExchangeMessage,
} from './gated-message-handler.js';

// Conversation manager for session threading
export { ConversationManager } from './conversation-manager.js';
export type {
  Conversation,
  ConversationMessage,
  ConversationManagerConfig,
  ProcessedMessageResult,
} from './conversation-manager.js';
