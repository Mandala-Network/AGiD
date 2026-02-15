/**
 * AGIdentity OpenClaw Gateway
 *
 * Bridges MessageBox → IdentityGate → OpenClaw → MPC Sign.
 * Wraps OpenClaw with AGIdentity's cryptographic identity layer so every
 * interaction is authenticated, encrypted, and signed.
 *
 * @example
 * ```typescript
 * import { createAGIdentityGateway } from 'agidentity';
 *
 * const gateway = await createAGIdentityGateway({
 *   wallet,
 *   trustedCertifiers: [caPublicKey],
 *   openclawUrl: 'ws://127.0.0.1:18789',
 *   openclawToken: 'your-token',
 * });
 *
 * // Gateway is now listening for messages
 * // All messages are verified, responses are signed
 *
 * await gateway.shutdown();
 * ```
 */

import type { AgentWallet } from '../wallet/agent-wallet.js';
import type { ProcessedMessage, MessageResponse } from '../messaging/messagebox-gateway.js';
import type { ChatMessageEvent } from '../types/openclaw-gateway.js';
import { MessageBoxGateway, createMessageBoxGateway } from '../messaging/messagebox-gateway.js';
import { IdentityGate } from '../identity/identity-gate.js';
import { OpenClawClient, createOpenClawClient } from '../openclaw/index.js';
import { SignedAuditTrail } from '../audit/signed-audit.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Configuration for AGIdentityOpenClawGateway
 */
export interface AGIdentityOpenClawGatewayConfig {
  /** Agent wallet for identity and signing (can be MPC) */
  wallet: AgentWallet;
  /** Trusted certificate authorities */
  trustedCertifiers: string[];
  /** OpenClaw Gateway URL (default: ws://127.0.0.1:18789) */
  openclawUrl?: string;
  /** OpenClaw auth token */
  openclawToken?: string;
  /** MessageBox configuration */
  messageBoxes?: string[];
  /** Whether to sign all AI responses (default: true) */
  signResponses?: boolean;
  /** Audit trail configuration */
  audit?: {
    /** Whether to enable audit trail (default: true) */
    enabled?: boolean;
  };
}

/**
 * Signed response data
 */
export interface SignedResponse {
  /** The original response content */
  content: string;
  /** Signature of the content */
  signature: string;
  /** Public key of the signer */
  signerPublicKey: string;
  /** Whether signing succeeded */
  signed: boolean;
}

/**
 * Identity context injected into OpenClaw sessions
 */
export interface IdentityContext {
  senderPublicKey: string;
  verified: boolean;
  certificateSubject?: string;
  conversationId: string;
}

// =============================================================================
// AGIdentityOpenClawGateway Class
// =============================================================================

/**
 * AGIdentityOpenClawGateway
 *
 * The unified gateway that bridges:
 * 1. MessageBox (P2P encrypted messaging)
 * 2. IdentityGate (certificate-based identity verification)
 * 3. OpenClaw (AI agent gateway)
 * 4. MPC Wallet (threshold signatures for responses)
 *
 * Every message is authenticated before reaching OpenClaw.
 * Every response is signed before delivery.
 */
export class AGIdentityOpenClawGateway {
  private config: Required<AGIdentityOpenClawGatewayConfig>;
  private wallet: AgentWallet;
  private messageBoxGateway: MessageBoxGateway | null = null;
  private openclawClient: OpenClawClient | null = null;
  private identityGate: IdentityGate | null = null;
  private auditTrail: SignedAuditTrail | null = null;
  private running = false;
  private agentPublicKey: string | null = null;

  // Track pending responses from OpenClaw
  private pendingResponses = new Map<string, {
    resolve: (response: string) => void;
    reject: (error: Error) => void;
    content: string;
  }>();

  constructor(config: AGIdentityOpenClawGatewayConfig) {
    // Apply defaults with environment variable support
    this.config = {
      wallet: config.wallet,
      trustedCertifiers: config.trustedCertifiers,
      openclawUrl: config.openclawUrl ?? process.env.OPENCLAW_GATEWAY_URL ?? 'ws://127.0.0.1:18789',
      openclawToken: config.openclawToken ?? process.env.OPENCLAW_GATEWAY_TOKEN ?? '',
      messageBoxes: config.messageBoxes ?? ['inbox'],
      signResponses: config.signResponses ?? (process.env.AGID_SIGN_RESPONSES !== 'false'),
      audit: {
        enabled: config.audit?.enabled ?? (process.env.AGID_AUDIT_ENABLED !== 'false'),
      },
    };

    this.wallet = config.wallet;
  }

  /**
   * Initialize the gateway
   *
   * Sets up all components:
   * 1. IdentityGate for certificate verification
   * 2. MessageBoxGateway for receiving messages
   * 3. OpenClawClient for AI interactions
   * 4. SignedAuditTrail for logging (if enabled)
   */
  async initialize(): Promise<void> {
    if (this.running) return;

    // Get agent's public key for audit trail
    const { publicKey } = await this.wallet.getPublicKey({ identityKey: true });
    this.agentPublicKey = publicKey;

    // 1. Create IdentityGate
    this.identityGate = new IdentityGate({
      wallet: this.wallet,
      trustedCertifiers: this.config.trustedCertifiers,
    });
    await this.identityGate.initialize();

    // 2. Create MessageBoxGateway with message handler
    this.messageBoxGateway = await createMessageBoxGateway({
      wallet: this.wallet,
      trustedCertifiers: this.config.trustedCertifiers,
      onMessage: async (message) => this.handleMessage(message),
      options: {
        messageBoxes: this.config.messageBoxes,
        onError: (error) => {
          console.error('[AGIdentityGateway] MessageBox error:', error.type, error.message);
        },
      },
    });

    // 3. Create OpenClawClient
    try {
      this.openclawClient = await createOpenClawClient({
        gatewayUrl: this.config.openclawUrl,
        authToken: this.config.openclawToken,
      });

      // Set up chat message handler
      this.openclawClient.onChatMessage((event) => this.handleChatMessage(event));
    } catch (error) {
      // OpenClaw connection failed - log but don't crash
      console.error('[AGIdentityGateway] OpenClaw connection failed:', error);
      // Gateway can still receive messages, will retry OpenClaw on demand
    }

    // 4. Create SignedAuditTrail if enabled
    if (this.config.audit.enabled) {
      this.auditTrail = new SignedAuditTrail({
        wallet: this.wallet,
      });
    }

    this.running = true;
  }

  /**
   * Handle incoming message from MessageBox
   *
   * Flow:
   * 1. Extract sender identity from verified message
   * 2. Create audit entry for incoming message
   * 3. Build context with sender identity
   * 4. Send to OpenClaw with identity context
   * 5. Wait for AI response
   * 6. Sign response with wallet
   * 7. Create audit entry for response
   * 8. Return MessageResponse
   */
  private async handleMessage(message: ProcessedMessage): Promise<MessageResponse | null> {
    const senderKey = message.original.sender;
    const content = typeof message.original.body === 'string'
      ? message.original.body
      : JSON.stringify(message.original.body);

    // 1. Create audit entry for incoming message
    if (this.auditTrail) {
      await this.auditTrail.createEntry({
        action: 'message.received',
        userPublicKey: senderKey,
        agentPublicKey: this.agentPublicKey!,
        input: content,
        metadata: {
          conversationId: message.context.conversationId,
          verified: message.context.identityVerified,
          certificateType: message.context.certificate?.type,
        },
      });
    }

    // 2. Build identity context
    const identityContext = this.buildIdentityContext(message);

    // 3. Send to OpenClaw with identity context
    let aiResponse: string;
    try {
      aiResponse = await this.sendToOpenClaw(content, identityContext);
    } catch (error) {
      console.error('[AGIdentityGateway] OpenClaw error:', error);

      // If OpenClaw is unavailable, return an error message
      aiResponse = 'Sorry, I am temporarily unavailable. Please try again later.';
    }

    // 4. Sign response with wallet
    let signedResponse: SignedResponse;
    if (this.config.signResponses) {
      signedResponse = await this.signResponse(aiResponse);
    } else {
      signedResponse = {
        content: aiResponse,
        signature: '',
        signerPublicKey: this.agentPublicKey!,
        signed: false,
      };
    }

    // 5. Create audit entry for response
    if (this.auditTrail) {
      await this.auditTrail.createEntry({
        action: 'message.sent',
        userPublicKey: senderKey,
        agentPublicKey: this.agentPublicKey!,
        output: aiResponse,
        metadata: {
          conversationId: message.context.conversationId,
          signed: signedResponse.signed,
        },
      });
    }

    // 6. Return response
    return {
      body: {
        content: signedResponse.content,
        signature: signedResponse.signature,
        signerPublicKey: signedResponse.signerPublicKey,
        signed: signedResponse.signed,
      },
    };
  }

  /**
   * Build identity context for OpenClaw session
   */
  private buildIdentityContext(message: ProcessedMessage): IdentityContext {
    const context: IdentityContext = {
      senderPublicKey: message.original.sender,
      verified: message.context.identityVerified,
      conversationId: message.context.conversationId,
    };

    // Add certificate subject if available
    if (message.context.certificate) {
      context.certificateSubject = message.context.certificate.fields.name
        ?? message.context.certificate.fields.employeeId
        ?? message.context.certificate.subject;
    }

    return context;
  }

  /**
   * Send message to OpenClaw with identity context
   */
  private async sendToOpenClaw(content: string, identityContext: IdentityContext): Promise<string> {
    // Ensure OpenClaw is connected
    if (!this.openclawClient || !this.openclawClient.isConnected()) {
      // Try to reconnect
      try {
        this.openclawClient = await createOpenClawClient({
          gatewayUrl: this.config.openclawUrl,
          authToken: this.config.openclawToken,
        });
        this.openclawClient.onChatMessage((event) => this.handleChatMessage(event));
      } catch {
        throw new Error('OpenClaw Gateway unavailable');
      }
    }

    // Create a promise to wait for the response
    return new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        const pending = this.pendingResponses.get(identityContext.conversationId);
        if (pending) {
          this.pendingResponses.delete(identityContext.conversationId);
          // Return accumulated content or reject
          if (pending.content) {
            resolve(pending.content);
          } else {
            reject(new Error('OpenClaw response timeout'));
          }
        }
      }, 60000); // 60 second timeout

      // Store pending response handler
      this.pendingResponses.set(identityContext.conversationId, {
        resolve: (response) => {
          clearTimeout(timeout);
          this.pendingResponses.delete(identityContext.conversationId);
          resolve(response);
        },
        reject: (error) => {
          clearTimeout(timeout);
          this.pendingResponses.delete(identityContext.conversationId);
          reject(error);
        },
        content: '',
      });

      // Send chat message with identity context
      this.openclawClient!.sendChat(content, {
        sessionId: identityContext.conversationId,
        context: {
          senderPublicKey: identityContext.senderPublicKey,
          verified: identityContext.verified,
          certificateSubject: identityContext.certificateSubject,
        },
      }).catch((error) => {
        const pending = this.pendingResponses.get(identityContext.conversationId);
        if (pending) {
          pending.reject(error);
        }
      });
    });
  }

  /**
   * Handle chat message from OpenClaw
   */
  private handleChatMessage(event: ChatMessageEvent): void {
    const sessionId = event.payload.sessionId;
    const pending = this.pendingResponses.get(sessionId);

    if (!pending) {
      // No pending request for this session - might be unsolicited
      return;
    }

    // Accumulate content (streaming)
    pending.content += event.payload.content;

    // If message is complete, resolve
    if (event.payload.done) {
      pending.resolve(pending.content);
    }
  }

  /**
   * Sign response content with wallet
   */
  private async signResponse(response: string): Promise<SignedResponse> {
    try {
      const data = Array.from(new TextEncoder().encode(response));
      const keyId = `response-${Date.now()}`;

      const signature = await this.wallet.createSignature({
        data,
        protocolID: [0, 'agidentity-response'],
        keyID: keyId,
      });

      const signatureHex = Array.from(signature.signature)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

      return {
        content: response,
        signature: signatureHex,
        signerPublicKey: this.agentPublicKey!,
        signed: true,
      };
    } catch (error) {
      // Signing failed - return unsigned response with warning
      console.error('[AGIdentityGateway] Signing failed:', error);
      return {
        content: response,
        signature: '',
        signerPublicKey: this.agentPublicKey!,
        signed: false,
      };
    }
  }

  /**
   * Shutdown the gateway gracefully
   *
   * Stops all listeners and disconnects from services.
   */
  async shutdown(): Promise<void> {
    if (!this.running) return;

    this.running = false;

    // Reject all pending responses
    for (const [, pending] of this.pendingResponses) {
      pending.reject(new Error('Gateway shutting down'));
    }
    this.pendingResponses.clear();

    // Stop MessageBoxGateway
    if (this.messageBoxGateway) {
      await this.messageBoxGateway.shutdown();
      this.messageBoxGateway = null;
    }

    // Disconnect OpenClawClient
    if (this.openclawClient) {
      await this.openclawClient.disconnect();
      this.openclawClient = null;
    }

    // Clean up IdentityGate (no explicit cleanup needed)
    this.identityGate = null;

    // Clean up AuditTrail (no explicit cleanup needed)
    this.auditTrail = null;
  }

  // ===========================================================================
  // Accessors
  // ===========================================================================

  /**
   * Check if the gateway is running
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Get the identity gate
   */
  getIdentityGate(): IdentityGate | null {
    return this.identityGate;
  }

  /**
   * Get the OpenClaw client
   */
  getOpenClawClient(): OpenClawClient | null {
    return this.openclawClient;
  }

  /**
   * Get the MessageBox gateway
   */
  getMessageBoxGateway(): MessageBoxGateway | null {
    return this.messageBoxGateway;
  }

  /**
   * Get the audit trail
   */
  getAuditTrail(): SignedAuditTrail | null {
    return this.auditTrail;
  }

  /**
   * Get the agent's public key
   */
  getAgentPublicKey(): string | null {
    return this.agentPublicKey;
  }
}
