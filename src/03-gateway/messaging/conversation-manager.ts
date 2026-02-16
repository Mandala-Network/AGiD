/**
 * Conversation Manager
 *
 * Manages conversation threading and session state for MessageBox communication.
 * Tracks ongoing conversations between participants with session-based encryption.
 */

import type { BRC100Wallet } from '../../07-shared/types/index.js';
import type { VerifiedMessage } from './gated-message-handler.js';
import { SessionEncryption } from '../encryption/per-interaction.js';

// =============================================================================
// Constants
// =============================================================================

/** Session timeout in milliseconds (30 minutes) */
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;

/** Cleanup interval in milliseconds (5 minutes) */
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

// =============================================================================
// Types
// =============================================================================

/**
 * A message tracked within a conversation
 */
export interface ConversationMessage {
  /** Unique message ID */
  messageId: string;
  /** Direction of the message */
  direction: 'inbound' | 'outbound';
  /** When the message was sent/received */
  timestamp: number;
  /** Preview of message body (first 100 chars) */
  bodyPreview: string;
}

/**
 * A conversation between participants
 */
export interface Conversation {
  /** Unique conversation ID */
  conversationId: string;
  /** The other party's public key */
  participantKey: string;
  /** Messages in this conversation */
  messages: ConversationMessage[];
  /** When the conversation started */
  createdAt: number;
  /** Last activity timestamp */
  lastActivityAt: number;
  /** Session encryption instance for PFS */
  sessionEncryption: SessionEncryption;
  /** Optional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Result of processing an incoming message
 */
export interface ProcessedMessageResult {
  /** The conversation this message belongs to */
  conversation: Conversation;
  /** Whether this is a new conversation */
  isNew: boolean;
}

/**
 * Configuration for ConversationManager
 */
export interface ConversationManagerConfig {
  /** The wallet to use for encryption */
  wallet: BRC100Wallet;
  /** Session timeout in milliseconds (default: 30 minutes) */
  sessionTimeoutMs?: number;
  /** Cleanup interval in milliseconds (default: 5 minutes) */
  cleanupIntervalMs?: number;
}

// =============================================================================
// ConversationManager Class
// =============================================================================

/**
 * ConversationManager
 *
 * Manages conversation threading and session state for MessageBox communication.
 * Each conversation has its own SessionEncryption instance for Perfect Forward Secrecy.
 *
 * @example
 * ```typescript
 * const manager = new ConversationManager({
 *   wallet,
 *   sessionTimeoutMs: 30 * 60 * 1000
 * });
 *
 * // Get or create a conversation
 * const conv = manager.getOrCreateConversation(participantKey);
 *
 * // Process incoming message
 * const { conversation, isNew } = manager.processIncomingMessage(verifiedMessage);
 *
 * // Use session encryption
 * const encrypted = await conversation.sessionEncryption.encryptOutbound('Hello');
 *
 * // Clean up when done
 * manager.destroy();
 * ```
 */
export class ConversationManager {
  private wallet: BRC100Wallet;
  private sessionTimeoutMs: number;
  private cleanupIntervalMs: number;

  /** Conversations by composite key: `${participantKey}:${conversationId}` */
  private conversations = new Map<string, Conversation>();

  /** Participant index: participantKey -> Set of conversationIds */
  private participantIndex = new Map<string, Set<string>>();

  /** Cleanup interval handle */
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(config: ConversationManagerConfig) {
    this.wallet = config.wallet;
    this.sessionTimeoutMs = config.sessionTimeoutMs ?? SESSION_TIMEOUT_MS;
    this.cleanupIntervalMs = config.cleanupIntervalMs ?? CLEANUP_INTERVAL_MS;

    // Start periodic cleanup
    this.startCleanup();
  }

  // ===========================================================================
  // Conversation Management
  // ===========================================================================

  /**
   * Get an existing conversation or create a new one
   *
   * @param participantKey - The other party's public key
   * @param conversationId - Optional conversation ID (generated if not provided)
   * @returns The conversation
   */
  getOrCreateConversation(
    participantKey: string,
    conversationId?: string
  ): Conversation {
    const convId = conversationId ?? this.generateConversationId(participantKey);
    const key = this.makeCompositeKey(participantKey, convId);

    // Check for existing
    const existing = this.conversations.get(key);
    if (existing) {
      // Update last activity
      existing.lastActivityAt = Date.now();
      return existing;
    }

    // Create new conversation
    const conversation: Conversation = {
      conversationId: convId,
      participantKey,
      messages: [],
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      sessionEncryption: new SessionEncryption(this.wallet, participantKey, convId),
    };

    // Store in maps
    this.conversations.set(key, conversation);

    // Update participant index
    let participantConvs = this.participantIndex.get(participantKey);
    if (!participantConvs) {
      participantConvs = new Set();
      this.participantIndex.set(participantKey, participantConvs);
    }
    participantConvs.add(convId);

    return conversation;
  }

  /**
   * Add a message to a conversation
   *
   * @param conversationId - The conversation ID
   * @param message - The message details
   * @param direction - Whether the message is inbound or outbound
   */
  addMessage(
    conversationId: string,
    message: { messageId: string; body: string | Record<string, unknown> },
    direction: 'inbound' | 'outbound'
  ): void {
    // Find the conversation by ID
    let conversation: Conversation | undefined;
    for (const conv of this.conversations.values()) {
      if (conv.conversationId === conversationId) {
        conversation = conv;
        break;
      }
    }

    if (!conversation) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }

    // Create body preview
    const bodyStr = typeof message.body === 'string'
      ? message.body
      : JSON.stringify(message.body);
    const bodyPreview = bodyStr.length > 100 ? bodyStr.slice(0, 100) + '...' : bodyStr;

    // Add message
    const convMessage: ConversationMessage = {
      messageId: message.messageId,
      direction,
      timestamp: Date.now(),
      bodyPreview,
    };

    conversation.messages.push(convMessage);
    conversation.lastActivityAt = Date.now();
  }

  /**
   * Get a conversation by ID
   *
   * @param conversationId - The conversation ID
   * @returns The conversation or undefined
   */
  getConversation(conversationId: string): Conversation | undefined {
    for (const conv of this.conversations.values()) {
      if (conv.conversationId === conversationId) {
        return conv;
      }
    }
    return undefined;
  }

  /**
   * Get all conversations for a participant
   *
   * @param participantKey - The participant's public key
   * @returns Array of conversations
   */
  getConversationsForParticipant(participantKey: string): Conversation[] {
    const convIds = this.participantIndex.get(participantKey);
    if (!convIds) {
      return [];
    }

    const conversations: Conversation[] = [];
    for (const convId of convIds) {
      const key = this.makeCompositeKey(participantKey, convId);
      const conv = this.conversations.get(key);
      if (conv) {
        conversations.push(conv);
      }
    }

    return conversations;
  }

  /**
   * End a conversation and clean up its resources
   *
   * @param conversationId - The conversation ID
   */
  endConversation(conversationId: string): void {
    // Find and remove the conversation
    for (const [key, conv] of this.conversations.entries()) {
      if (conv.conversationId === conversationId) {
        // Remove from participant index
        const participantConvs = this.participantIndex.get(conv.participantKey);
        if (participantConvs) {
          participantConvs.delete(conversationId);
          if (participantConvs.size === 0) {
            this.participantIndex.delete(conv.participantKey);
          }
        }

        // Remove conversation
        this.conversations.delete(key);
        return;
      }
    }
  }

  // ===========================================================================
  // Message Flow Integration
  // ===========================================================================

  /**
   * Process an incoming verified message
   *
   * Extracts conversation ID from message body if present, or generates one.
   * Gets or creates the conversation and adds the message.
   *
   * @param message - The verified incoming message
   * @returns The conversation and whether it's new
   */
  processIncomingMessage(message: VerifiedMessage): ProcessedMessageResult {
    // Try to extract conversationId from message body
    let conversationId: string | undefined;
    if (typeof message.body === 'object' && message.body !== null) {
      const body = message.body as Record<string, unknown>;
      if (typeof body.conversationId === 'string') {
        conversationId = body.conversationId;
      }
    }

    // Check if conversation exists
    const existingConv = conversationId ? this.getConversation(conversationId) : undefined;
    const isNew = !existingConv;

    // Get or create conversation
    const conversation = this.getOrCreateConversation(
      message.sender,
      conversationId
    );

    // Add the message
    this.addMessage(
      conversation.conversationId,
      { messageId: message.messageId, body: message.body },
      'inbound'
    );

    return { conversation, isNew };
  }

  /**
   * Prepare an outgoing message body with conversation context
   *
   * @param participantKey - The recipient's public key
   * @param conversationId - The conversation ID
   * @param body - The message body to send
   * @returns The prepared message body with conversationId included
   */
  prepareOutgoingMessage(
    participantKey: string,
    conversationId: string,
    body: string | Record<string, unknown>
  ): Record<string, unknown> {
    // Get the conversation (must exist)
    const key = this.makeCompositeKey(participantKey, conversationId);
    const conversation = this.conversations.get(key);

    if (!conversation) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }

    // Prepare body with conversationId
    let preparedBody: Record<string, unknown>;
    if (typeof body === 'string') {
      preparedBody = {
        content: body,
        conversationId,
      };
    } else {
      preparedBody = {
        ...body,
        conversationId,
      };
    }

    // Track the outgoing message (no messageId yet - will be set after send)
    conversation.lastActivityAt = Date.now();

    return preparedBody;
  }

  /**
   * Get the SessionEncryption instance for a conversation
   *
   * @param conversationId - The conversation ID
   * @returns The SessionEncryption instance or undefined
   */
  getSessionEncryption(conversationId: string): SessionEncryption | undefined {
    const conversation = this.getConversation(conversationId);
    return conversation?.sessionEncryption;
  }

  // ===========================================================================
  // Cleanup
  // ===========================================================================

  /**
   * Clean up stale conversations
   *
   * Removes conversations that haven't had activity within the session timeout.
   */
  cleanupStaleConversations(): void {
    const now = Date.now();
    const staleKeys: string[] = [];

    for (const [key, conv] of this.conversations.entries()) {
      if (now - conv.lastActivityAt > this.sessionTimeoutMs) {
        staleKeys.push(key);

        // Remove from participant index
        const participantConvs = this.participantIndex.get(conv.participantKey);
        if (participantConvs) {
          participantConvs.delete(conv.conversationId);
          if (participantConvs.size === 0) {
            this.participantIndex.delete(conv.participantKey);
          }
        }
      }
    }

    // Remove stale conversations
    for (const key of staleKeys) {
      this.conversations.delete(key);
    }
  }

  /**
   * Start the periodic cleanup interval
   */
  private startCleanup(): void {
    if (this.cleanupInterval) {
      return;
    }

    this.cleanupInterval = setInterval(() => {
      this.cleanupStaleConversations();
    }, this.cleanupIntervalMs);
  }

  /**
   * Stop the periodic cleanup and clean up resources
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    this.conversations.clear();
    this.participantIndex.clear();
  }

  // ===========================================================================
  // Stats and Debug
  // ===========================================================================

  /**
   * Get conversation statistics
   */
  getStats(): {
    totalConversations: number;
    totalParticipants: number;
    totalMessages: number;
  } {
    let totalMessages = 0;
    for (const conv of this.conversations.values()) {
      totalMessages += conv.messages.length;
    }

    return {
      totalConversations: this.conversations.size,
      totalParticipants: this.participantIndex.size,
      totalMessages,
    };
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  /**
   * Generate a composite key for the conversations map
   */
  private makeCompositeKey(participantKey: string, conversationId: string): string {
    return `${participantKey}:${conversationId}`;
  }

  /**
   * Generate a unique conversation ID
   */
  private generateConversationId(participantKey: string): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 10);
    // Use first 8 chars of participant key for readability
    const participantPrefix = participantKey.substring(0, 8);
    return `conv-${participantPrefix}-${timestamp}-${random}`;
  }
}
