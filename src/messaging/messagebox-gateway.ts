/**
 * MessageBox Gateway
 *
 * Unified entry point for AI communication via MessageBox.
 * Orchestrates the complete message lifecycle: receive → verify → track → process → respond.
 *
 * @example
 * ```typescript
 * const gateway = await createMessageBoxGateway({
 *   wallet,
 *   trustedCertifiers: [caPublicKey],
 *   onMessage: async (msg) => {
 *     console.log(`From ${msg.original.sender}: ${msg.original.body}`);
 *     return { body: 'Message received!' };
 *   }
 * });
 * // Gateway is now listening for messages
 *
 * // Send a message in a conversation
 * await gateway.sendMessage(recipientKey, 'Hello!', conversation.conversationId);
 *
 * // Graceful shutdown
 * await gateway.shutdown();
 * ```
 */

import type { AgentWallet } from '../wallet/agent-wallet.js';
import type { Certificate } from '../types/index.js';
import type { VerifiedMessage } from './gated-message-handler.js';
import type { Conversation } from './conversation-manager.js';
import { AGIDMessageClient, createMessageClient } from './message-client.js';
import { GatedMessageHandler } from './gated-message-handler.js';
import { ConversationManager } from './conversation-manager.js';
import { IdentityGate } from '../identity/identity-gate.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Context about the message processing
 */
export interface ProcessingContext {
  /** Whether the sender's identity was verified */
  identityVerified: boolean;
  /** The sender's certificate (if verified) */
  certificate?: Certificate;
  /** The conversation ID */
  conversationId: string;
  /** Whether this is a new conversation */
  isNewConversation: boolean;
}

/**
 * A fully processed message with all context
 */
export interface ProcessedMessage {
  /** The original verified message */
  original: VerifiedMessage;
  /** The conversation this message belongs to */
  conversation: Conversation;
  /** Processing context */
  context: ProcessingContext;
}

/**
 * Response to send back to the sender
 */
export interface MessageResponse {
  /** The response body */
  body: string | Record<string, unknown>;
  /** Whether to encrypt the response (default: true) */
  encrypt?: boolean;
}

/**
 * Gateway error types
 */
export type GatewayErrorType = 'verification' | 'processing' | 'delivery';

/**
 * Error information from the gateway
 */
export interface GatewayError {
  /** Type of error */
  type: GatewayErrorType;
  /** Error message */
  message: string;
  /** The original message that caused the error (if available) */
  originalMessage?: VerifiedMessage;
}

/**
 * Configuration for MessageBoxGateway
 */
export interface MessageBoxGatewayConfig {
  /** The agent's wallet */
  wallet: AgentWallet;
  /** The identity gate for verification */
  identityGate: IdentityGate;
  /** Which message boxes to listen on (default: ['inbox']) */
  messageBoxes?: string[];
  /** Require certificate for all senders (default: true) */
  requireCertificate?: boolean;
  /** Handler for incoming messages */
  onMessage: (message: ProcessedMessage) => Promise<MessageResponse | null>;
  /** Handler for errors (optional) */
  onError?: (error: GatewayError) => void;
}

/**
 * Simplified configuration for the factory function
 */
export interface CreateGatewayConfig {
  /** The agent's wallet */
  wallet: AgentWallet;
  /** Trusted certificate authorities */
  trustedCertifiers: string[];
  /** Handler for incoming messages */
  onMessage: (message: ProcessedMessage) => Promise<MessageResponse | null>;
  /** Optional configuration */
  options?: {
    /** Which message boxes to listen on (default: ['inbox']) */
    messageBoxes?: string[];
    /** Require certificate for all senders (default: true) */
    requireCertificate?: boolean;
    /** Handler for errors */
    onError?: (error: GatewayError) => void;
  };
}

// =============================================================================
// MessageBoxGateway Class
// =============================================================================

/**
 * MessageBoxGateway
 *
 * Unified entry point for AI communication via MessageBox.
 * Orchestrates the complete message lifecycle:
 * 1. Message arrives via MessageBoxClient
 * 2. GatedMessageHandler verifies sender identity
 * 3. ConversationManager tracks the conversation
 * 4. onMessage callback receives ProcessedMessage with full context
 * 5. If callback returns MessageResponse, reply is sent
 * 6. Original message is acknowledged
 */
export class MessageBoxGateway {
  private wallet: AgentWallet;
  private identityGate: IdentityGate;
  private messageBoxes: string[];
  private requireCertificate: boolean;
  private onMessage: (message: ProcessedMessage) => Promise<MessageResponse | null>;
  private onError?: (error: GatewayError) => void;

  // Internal components
  private messageClient: AGIDMessageClient;
  private gatedHandler: GatedMessageHandler;
  private conversationManager: ConversationManager;

  // State
  private initialized = false;
  private running = false;
  private processing = false;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Create a new MessageBoxGateway
   *
   * @param config - Gateway configuration
   */
  constructor(config: MessageBoxGatewayConfig) {
    this.wallet = config.wallet;
    this.identityGate = config.identityGate;
    this.messageBoxes = config.messageBoxes ?? ['inbox'];
    this.requireCertificate = config.requireCertificate ?? true;
    this.onMessage = config.onMessage;
    this.onError = config.onError;

    // Create internal components
    this.messageClient = createMessageClient({ wallet: this.wallet });

    this.gatedHandler = new GatedMessageHandler({
      messageClient: this.messageClient,
      identityGate: this.identityGate,
      config: {
        requireCertificate: this.requireCertificate,
        sendRejectionNotice: false,
      },
    });

    // Create conversation manager with the AgentWallet (which implements BRC100Wallet)
    this.conversationManager = new ConversationManager({
      wallet: this.wallet,
    });
  }

  /**
   * Initialize the gateway
   *
   * Must be called before the gateway can receive messages.
   * Does NOT start polling — call startMessagePolling() separately
   * to avoid concurrent signing during other initialization steps.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Initialize message client
    await this.messageClient.initialize();

    // Initialize identity gate
    await this.identityGate.initialize();

    // Skip certificate exchange live listener (requires authsocket)
    // Certificate exchange can be handled reactively if needed

    this.initialized = true;
    this.running = true;
  }

  /**
   * Start listening for messages via AuthSocket WebSocket.
   * Call this AFTER all other initialization (e.g. wallet setup)
   * to prevent concurrent signing operations.
   */
  startMessagePolling(): void {
    if (!this.running) return;
    this.startLiveListeners();
  }

  /**
   * Handle an incoming verified message
   */
  private async handleMessage(message: VerifiedMessage): Promise<void> {
    try {
      // Track in conversation
      const { conversation, isNew } = this.conversationManager.processIncomingMessage(message);

      // Build processing context
      const context: ProcessingContext = {
        identityVerified: message.verified,
        certificate: message.certificate,
        conversationId: conversation.conversationId,
        isNewConversation: isNew,
      };

      // Build processed message
      const processedMessage: ProcessedMessage = {
        original: message,
        conversation,
        context,
      };

      // Call user's message handler
      const handlerStart = Date.now();
      console.log(`[MessageBoxGateway]    Calling onMessage handler...`);
      let response: MessageResponse | null = null;
      try {
        response = await this.onMessage(processedMessage);
        console.log(`[MessageBoxGateway]    onMessage handler returned [took ${Date.now() - handlerStart}ms]`);
      } catch (error) {
        this.emitError({
          type: 'processing',
          message: error instanceof Error ? error.message : 'Unknown processing error',
          originalMessage: message,
        });
      }

      // Send response if provided
      if (response) {
        const sendStart = Date.now();
        try {
          console.log(`[MessageBoxGateway] 📤 Sending response to ${message.sender.substring(0, 12)}... (box: ${message.messageBox})`);
          // Prepare the response body with conversation context
          const preparedBody = this.conversationManager.prepareOutgoingMessage(
            message.sender,
            conversation.conversationId,
            response.body
          );

          // Send via message client
          const sendResult = await this.messageClient.sendMessage(
            message.sender,
            message.messageBox,
            preparedBody,
            { skipEncryption: response.encrypt === false }
          );
          console.log(`[MessageBoxGateway] ✅ Response sent (messageId: ${sendResult.messageId}) [send took ${Date.now() - sendStart}ms]`);

          // Track outgoing message in conversation
          this.conversationManager.addMessage(
            conversation.conversationId,
            { messageId: sendResult.messageId, body: preparedBody },
            'outbound'
          );
        } catch (error) {
          console.error(`[MessageBoxGateway] ❌ Response delivery failed:`, error instanceof Error ? error.message : error);
          this.emitError({
            type: 'delivery',
            message: error instanceof Error ? error.message : 'Failed to send response',
            originalMessage: message,
          });
        }
      }

      // Acknowledge the original message
      await this.gatedHandler.acknowledgeMessage(message.messageId);
    } catch (error) {
      this.emitError({
        type: 'processing',
        message: error instanceof Error ? error.message : 'Unknown error handling message',
        originalMessage: message,
      });
    }
  }

  /**
   * Start live WebSocket listeners on all message boxes via AuthSocket.
   * Uses a processing guard to prevent concurrent signing operations.
   * Falls back to polling if WebSocket connection fails.
   */
  private startLiveListeners(): void {
    // Queue for messages that arrive while another is being processed
    const messageQueue: VerifiedMessage[] = [];
    // Track message IDs already queued/processing to avoid duplicates from poll + WebSocket
    const seenMessageIds = new Set<string>();

    const processQueue = async () => {
      if (this.processing || messageQueue.length === 0) return;
      this.processing = true;
      try {
        while (messageQueue.length > 0 && this.running) {
          const message = messageQueue.shift()!;
          console.log(`[MessageBoxGateway]    Processing message from ${message.sender.substring(0, 12)}... (id: ${message.messageId})`);
          await this.handleMessage(message);
        }
      } finally {
        this.processing = false;
      }
    };

    // Register live listener for each message box
    for (const messageBox of this.messageBoxes) {
      this.messageClient.onMessage(messageBox, async (rawMessage) => {
        if (!this.running) return;
        if (seenMessageIds.has(rawMessage.messageId)) return;
        seenMessageIds.add(rawMessage.messageId);
        const t0 = Date.now();
        console.log(`[MessageBoxGateway] 📬 Live message in "${messageBox}" from ${rawMessage.sender.substring(0, 12)}... [t=0ms]`);

        // Verify sender identity
        const verified = await this.gatedHandler.verifyAndHandle(rawMessage);
        console.log(`[MessageBoxGateway]    Verification done (verified=${verified.verified}) [t=${Date.now() - t0}ms]`);
        messageQueue.push(verified);
        processQueue();
      });

      // Start WebSocket listener (auto-connects AuthSocket)
      this.messageClient.listenForMessages(messageBox).then(() => {
        console.log(`[MessageBoxGateway] WebSocket listener started for "${messageBox}"`);
      }).catch((error) => {
        console.warn(`[MessageBoxGateway] WebSocket listener failed for "${messageBox}": ${error instanceof Error ? error.message : 'Unknown'}`);
        console.warn(`[MessageBoxGateway] Falling back to polling only for "${messageBox}"`);
        this.emitError({
          type: 'processing',
          message: `WebSocket listener failed for "${messageBox}": ${error instanceof Error ? error.message : 'Unknown'}`,
        });
      });
    }

    // Also do an initial poll to pick up any messages that arrived before the WebSocket connected
    this.drainPendingMessages().catch((error) => {
      this.emitError({
        type: 'processing',
        message: `Initial drain failed: ${error instanceof Error ? error.message : 'Unknown'}`,
      });
    });

    // Periodic polling fallback — WebSocket may silently fail to deliver
    const pollIntervalMs = 3000;
    const pollFallback = async () => {
      if (!this.running) return;
      try {
        for (const messageBox of this.messageBoxes) {
          if (!this.running) break;
          const messages = await this.gatedHandler.listVerifiedMessages(messageBox);
          for (const msg of messages) {
            if (seenMessageIds.has(msg.messageId)) continue;
            seenMessageIds.add(msg.messageId);
            console.log(`[MessageBoxGateway] 📬 Polled message in "${messageBox}" from ${msg.sender.substring(0, 12)}...`);
            messageQueue.push(msg);
          }
          if (messageQueue.length > 0) processQueue();
        }
      } catch {
        // Transient poll error — will retry next cycle
      }
      if (this.running) {
        this.pollTimer = setTimeout(pollFallback, pollIntervalMs);
      }
    };
    this.pollTimer = setTimeout(pollFallback, pollIntervalMs);
  }

  /**
   * Drain any pending messages that arrived before the WebSocket connected.
   * Called once at startup.
   */
  private async drainPendingMessages(): Promise<void> {
    for (const messageBox of this.messageBoxes) {
      if (!this.running) break;
      try {
        const messages = await this.gatedHandler.listVerifiedMessages(messageBox);
        if (messages.length > 0) {
          console.log(`[MessageBoxGateway] 📬 Draining ${messages.length} pending message(s) from "${messageBox}"`);
        }
        for (const message of messages) {
          if (!this.running) break;
          await this.handleMessage(message);
        }
      } catch (error) {
        this.emitError({
          type: 'processing',
          message: `Drain error (${messageBox}): ${error instanceof Error ? error.message : 'Unknown'}`,
        });
      }
    }
  }

  /**
   * Emit an error to the error handler
   */
  private emitError(error: GatewayError): void {
    if (this.onError) {
      this.onError(error);
    }
  }

  /**
   * Shutdown the gateway gracefully
   *
   * Stops listeners, clears intervals, and cleans up resources.
   */
  async shutdown(): Promise<void> {
    if (!this.running) return;

    this.running = false;

    // Stop certificate exchange
    this.gatedHandler.stopCertificateExchange();

    // Remove message handlers
    for (const messageBox of this.messageBoxes) {
      this.gatedHandler.offVerifiedMessage(messageBox);
    }

    // Disconnect WebSocket
    await this.messageClient.disconnect();

    // Clean up conversation manager
    this.conversationManager.destroy();

    // Clear timers
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  // ===========================================================================
  // Convenience Methods
  // ===========================================================================

  /**
   * Send a message to a recipient
   *
   * @param recipientKey - The recipient's public key
   * @param body - The message body
   * @param conversationId - Optional conversation ID to continue a conversation
   * @returns The message ID
   */
  async sendMessage(
    recipientKey: string,
    body: string | Record<string, unknown>,
    conversationId?: string
  ): Promise<{ messageId: string }> {
    this.ensureRunning();

    let preparedBody: string | Record<string, unknown>;

    if (conversationId) {
      // Use existing conversation's context
      const conversation = this.conversationManager.getConversation(conversationId);
      if (conversation) {
        preparedBody = this.conversationManager.prepareOutgoingMessage(
          recipientKey,
          conversationId,
          body
        );
      } else {
        // Conversation not found, send without context
        preparedBody = body;
      }
    } else {
      preparedBody = body;
    }

    const result = await this.messageClient.sendMessage(
      recipientKey,
      'inbox',
      preparedBody
    );

    // Track outgoing message if in conversation
    if (conversationId) {
      try {
        this.conversationManager.addMessage(
          conversationId,
          { messageId: result.messageId, body: preparedBody },
          'outbound'
        );
      } catch {
        // Ignore if conversation doesn't exist
      }
    }

    return { messageId: result.messageId };
  }

  /**
   * Get a conversation by ID
   *
   * @param conversationId - The conversation ID
   * @returns The conversation or undefined
   */
  getConversation(conversationId: string): Conversation | undefined {
    return this.conversationManager.getConversation(conversationId);
  }

  /**
   * Get all conversations with a specific participant
   *
   * @param participantKey - The participant's public key
   * @returns Array of conversations
   */
  getConversationsWithParticipant(participantKey: string): Conversation[] {
    return this.conversationManager.getConversationsForParticipant(participantKey);
  }

  /**
   * Get the identity gate for admin operations
   *
   * Useful for certificate issuance, revocation, and other administrative tasks.
   *
   * @returns The identity gate
   */
  getIdentityGate(): IdentityGate {
    return this.identityGate;
  }

  /**
   * Check if the gateway is running
   *
   * @returns Whether the gateway is actively listening
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Get the underlying message client
   *
   * @returns The AGIDMessageClient instance
   */
  getMessageClient(): AGIDMessageClient {
    return this.messageClient;
  }

  /**
   * Get the gated message handler
   *
   * @returns The GatedMessageHandler instance
   */
  getGatedHandler(): GatedMessageHandler {
    return this.gatedHandler;
  }

  /**
   * Get the conversation manager
   *
   * @returns The ConversationManager instance
   */
  getConversationManager(): ConversationManager {
    return this.conversationManager;
  }

  /**
   * Register a sender's certificate for verification
   *
   * @param senderKey - The sender's public key
   * @param certificate - The sender's certificate
   */
  registerSenderCertificate(senderKey: string, certificate: Certificate): void {
    this.gatedHandler.registerSenderCertificate(senderKey, certificate);
  }

  /**
   * Set the gateway's own certificate for sharing in exchanges
   *
   * @param certificate - The certificate to share
   */
  setOwnCertificate(certificate: Certificate): void {
    this.gatedHandler.setOwnCertificate(certificate);
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  /**
   * Ensure the gateway is running before operations
   */
  private ensureRunning(): void {
    if (!this.running) {
      throw new Error('Gateway is not running. Call initialize() first.');
    }
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a fully initialized MessageBoxGateway
 *
 * This is the recommended way to create a gateway. It creates the IdentityGate
 * internally and initializes everything before returning.
 *
 * @param config - Gateway configuration
 * @returns Initialized MessageBoxGateway
 *
 * @example
 * ```typescript
 * const gateway = await createMessageBoxGateway({
 *   wallet,
 *   trustedCertifiers: [caPublicKey],
 *   onMessage: async (msg) => {
 *     console.log(`Received: ${msg.original.body}`);
 *     if (msg.context.identityVerified) {
 *       return { body: 'Thanks for the verified message!' };
 *     }
 *     return null;
 *   }
 * });
 * ```
 */
export async function createMessageBoxGateway(
  config: CreateGatewayConfig
): Promise<MessageBoxGateway> {
  // Create identity gate using the AgentWallet (which implements BRC100Wallet)
  const identityGate = new IdentityGate({
    wallet: config.wallet,
    trustedCertifiers: config.trustedCertifiers,
    requireCertificate: config.options?.requireCertificate ?? true,
  });

  // Create gateway
  const gateway = new MessageBoxGateway({
    wallet: config.wallet,
    identityGate,
    messageBoxes: config.options?.messageBoxes,
    requireCertificate: config.options?.requireCertificate,
    onMessage: config.onMessage,
    onError: config.options?.onError,
  });

  // Initialize and return
  await gateway.initialize();

  return gateway;
}
