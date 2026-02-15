/**
 * Gated Message Handler
 *
 * Wraps AGIDMessageClient with IdentityGate for sender verification.
 * Every incoming message must have its sender's identity verified before processing.
 */

import { z } from 'zod';
import type { AGIDMessage, MessageHandler } from './message-client.js';
import type { AGIDMessageClient } from './message-client.js';
import type { IdentityGate, IdentityVerificationResult } from '../identity/identity-gate.js';
import type { Certificate } from '../types/index.js';

// =============================================================================
// Zod Schemas
// =============================================================================

/**
 * Configuration schema for GatedMessageHandler
 */
const GatedMessageHandlerConfigSchema = z.object({
  /** Require certificate for all senders (default: true) */
  requireCertificate: z.boolean().default(true),
  /** Send rejection notice when message rejected (default: false) */
  sendRejectionNotice: z.boolean().default(false),
  /** Cache verified certificates for this many ms (default: 300000 = 5 min) */
  verificationCacheMs: z.number().min(0).default(300000),
});

export type GatedMessageHandlerConfig = z.infer<typeof GatedMessageHandlerConfigSchema>;

// =============================================================================
// Types
// =============================================================================

/**
 * A message with verification status attached
 */
export interface VerifiedMessage extends AGIDMessage {
  /** Whether the sender's identity was verified */
  verified: boolean;
  /** The sender's certificate (if verified) */
  certificate?: Certificate;
  /** Verification error message (if not verified) */
  verificationError?: string;
}

/**
 * Handler for verified messages
 */
export type VerifiedMessageHandler = (message: VerifiedMessage) => Promise<void>;

/**
 * Cached verification entry
 */
interface CachedVerification {
  result: IdentityVerificationResult;
  certificate: Certificate;
  expiresAt: number;
}

/**
 * Rejection notice message structure
 */
interface RejectionNotice {
  type: 'rejection-notice';
  originalMessageId: string;
  reason: string;
  timestamp: string;
}

// =============================================================================
// GatedMessageHandler Class
// =============================================================================

/**
 * GatedMessageHandler
 *
 * Wraps AGIDMessageClient with IdentityGate for sender verification.
 * All incoming messages are verified before being passed to the user's handler.
 *
 * @example
 * ```typescript
 * const handler = new GatedMessageHandler({
 *   messageClient,
 *   identityGate,
 *   config: { requireCertificate: true }
 * });
 *
 * // Register known sender certificate
 * handler.registerSenderCertificate(senderKey, certificate);
 *
 * // Handle verified messages
 * handler.onVerifiedMessage('inbox', async (msg) => {
 *   if (msg.verified) {
 *     console.log('Verified message from:', msg.certificate?.subject);
 *   } else {
 *     console.log('Unverified:', msg.verificationError);
 *   }
 * });
 *
 * await handler.listenForMessages('inbox');
 * ```
 */
export class GatedMessageHandler {
  private messageClient: AGIDMessageClient;
  private identityGate: IdentityGate;
  private config: GatedMessageHandlerConfig;

  /** Cache of registered sender certificates by sender public key */
  private senderCertificates = new Map<string, Certificate>();

  /** Cache of verification results by sender public key */
  private verificationCache = new Map<string, CachedVerification>();

  /** User's verified message handlers by messageBox */
  private verifiedHandlers = new Map<string, VerifiedMessageHandler>();

  constructor(params: {
    messageClient: AGIDMessageClient;
    identityGate: IdentityGate;
    config?: Partial<GatedMessageHandlerConfig>;
  }) {
    this.messageClient = params.messageClient;
    this.identityGate = params.identityGate;
    this.config = GatedMessageHandlerConfigSchema.parse(params.config ?? {});
  }

  // ===========================================================================
  // Certificate Registration
  // ===========================================================================

  /**
   * Pre-register a sender's certificate for verification
   *
   * @param senderKey - The sender's public key
   * @param certificate - The sender's certificate
   */
  registerSenderCertificate(senderKey: string, certificate: Certificate): void {
    this.senderCertificates.set(senderKey, certificate);
    // Clear any cached verification for this sender
    this.verificationCache.delete(senderKey);
  }

  /**
   * Remove a sender's registered certificate
   *
   * @param senderKey - The sender's public key
   */
  unregisterSenderCertificate(senderKey: string): void {
    this.senderCertificates.delete(senderKey);
    this.verificationCache.delete(senderKey);
  }

  /**
   * Check if a sender has a registered certificate
   *
   * @param senderKey - The sender's public key
   */
  hasSenderCertificate(senderKey: string): boolean {
    return this.senderCertificates.has(senderKey);
  }

  /**
   * Get a sender's registered certificate
   *
   * @param senderKey - The sender's public key
   */
  getSenderCertificate(senderKey: string): Certificate | undefined {
    return this.senderCertificates.get(senderKey);
  }

  // ===========================================================================
  // Message Handling
  // ===========================================================================

  /**
   * Register a handler for verified messages on a specific messageBox
   *
   * @param messageBox - The messageBox to listen on
   * @param handler - Handler called with verified messages
   */
  onVerifiedMessage(messageBox: string, handler: VerifiedMessageHandler): void {
    this.verifiedHandlers.set(messageBox, handler);

    // Create wrapper handler that verifies before calling user handler
    const wrappedHandler: MessageHandler = async (message: AGIDMessage) => {
      const verifiedMessage = await this.verifyAndHandle(message);

      // If requireCertificate is true and not verified, optionally send rejection
      if (this.config.requireCertificate && !verifiedMessage.verified) {
        if (this.config.sendRejectionNotice) {
          await this.sendRejectionNotice(message, verifiedMessage.verificationError ?? 'Unknown error');
        }
        // Still call handler so user can log/track rejected messages
      }

      await handler(verifiedMessage);
    };

    // Register with underlying message client
    this.messageClient.onMessage(messageBox, wrappedHandler);
  }

  /**
   * Remove a verified message handler
   *
   * @param messageBox - The messageBox to stop listening on
   */
  offVerifiedMessage(messageBox: string): void {
    this.verifiedHandlers.delete(messageBox);
    this.messageClient.offMessage(messageBox);
  }

  /**
   * Start listening for messages on a messageBox
   *
   * @param messageBox - The messageBox to listen on
   */
  async listenForMessages(messageBox: string): Promise<void> {
    await this.messageClient.listenForMessages(messageBox);
  }

  /**
   * List pending messages with verification status
   *
   * @param messageBox - The messageBox to list from
   */
  async listVerifiedMessages(messageBox: string): Promise<VerifiedMessage[]> {
    const messages = await this.messageClient.listMessages(messageBox);
    const verifiedMessages: VerifiedMessage[] = [];

    for (const message of messages) {
      const verified = await this.verifyAndHandle(message);
      verifiedMessages.push(verified);
    }

    return verifiedMessages;
  }

  /**
   * Acknowledge (delete) processed messages
   *
   * @param messageIds - Message ID(s) to acknowledge
   */
  async acknowledgeMessage(messageIds: string | string[]): Promise<void> {
    await this.messageClient.acknowledgeMessage(messageIds);
  }

  // ===========================================================================
  // Verification
  // ===========================================================================

  /**
   * Verify a message sender and attach verification result
   *
   * @param message - The incoming message
   * @returns The message with verification status attached
   */
  async verifyAndHandle(message: AGIDMessage): Promise<VerifiedMessage> {
    const senderKey = message.sender;

    // Check verification cache first
    const cached = this.getCachedVerification(senderKey);
    if (cached) {
      return {
        ...message,
        verified: cached.result.verified,
        certificate: cached.certificate,
        verificationError: cached.result.error,
      };
    }

    // Check if sender has registered certificate
    const certificate = this.senderCertificates.get(senderKey);

    if (!certificate) {
      // No certificate registered
      if (this.config.requireCertificate) {
        return {
          ...message,
          verified: false,
          verificationError: 'No certificate registered for sender',
        };
      }

      // Certificate not required - pass through as unverified
      return {
        ...message,
        verified: false,
        verificationError: 'No certificate available (not required)',
      };
    }

    // Verify with IdentityGate
    const result = await this.identityGate.verifyIdentity(certificate);

    // Cache the result
    this.cacheVerification(senderKey, result, certificate);

    return {
      ...message,
      verified: result.verified,
      certificate: result.verified ? certificate : undefined,
      verificationError: result.error,
    };
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  /**
   * Get cached verification result if still valid
   */
  private getCachedVerification(senderKey: string): CachedVerification | null {
    const cached = this.verificationCache.get(senderKey);
    if (!cached) return null;

    if (Date.now() > cached.expiresAt) {
      this.verificationCache.delete(senderKey);
      return null;
    }

    return cached;
  }

  /**
   * Cache a verification result
   */
  private cacheVerification(
    senderKey: string,
    result: IdentityVerificationResult,
    certificate: Certificate
  ): void {
    // Don't cache failures for as long
    const cacheTime = result.verified
      ? this.config.verificationCacheMs
      : Math.min(this.config.verificationCacheMs, 30000);

    this.verificationCache.set(senderKey, {
      result,
      certificate,
      expiresAt: Date.now() + cacheTime,
    });
  }

  /**
   * Send a rejection notice to the sender
   */
  private async sendRejectionNotice(message: AGIDMessage, reason: string): Promise<void> {
    const notice: RejectionNotice = {
      type: 'rejection-notice',
      originalMessageId: message.messageId,
      reason,
      timestamp: new Date().toISOString(),
    };

    try {
      await this.messageClient.sendMessage(
        message.sender,
        'agid-system',  // System messageBox for notices
        notice
      );
    } catch {
      // Ignore send failures for rejection notices
    }
  }

  /**
   * Clear verification cache
   */
  clearVerificationCache(): void {
    this.verificationCache.clear();
  }

  /**
   * Get the underlying message client
   */
  getMessageClient(): AGIDMessageClient {
    return this.messageClient;
  }

  /**
   * Get the identity gate
   */
  getIdentityGate(): IdentityGate {
    return this.identityGate;
  }
}
