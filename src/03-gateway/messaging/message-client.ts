/**
 * AGIdentity Message Client
 *
 * Wrapper around @bsv/message-box-client for async agent-to-agent messaging.
 * MessageBoxClient handles encryption automatically using BRC-2 ECDH.
 */

import { MessageBoxClient, PeerPayClient } from '@bsv/message-box-client';
import type { AgentWallet } from '../../01-core/wallet/agent-wallet.js';
import { getConfig } from '../../01-core/config/index.js';

/**
 * Configuration for the message client
 */
export interface AGIDMessageConfig {
  wallet: AgentWallet;
  messageBoxHost?: string;
  enableLogging?: boolean;
  networkPreset?: 'local' | 'mainnet' | 'testnet';
}

/**
 * A message received from a peer
 */
export interface AGIDMessage {
  messageId: string;
  sender: string;
  body: string | Record<string, unknown>;
  createdAt: string;
  messageBox: string;
}

/**
 * An incoming payment
 */
export interface AGIDPayment {
  messageId: string;
  sender: string;
  amount: number;
  token: unknown;
}

/**
 * Permission status for a message box
 */
export interface AGIDPermission {
  sender: string | null;
  messageBox: string;
  recipientFee: number;
  status: 'always_allow' | 'blocked' | 'payment_required';
  createdAt: string;
  updatedAt: string;
}

/**
 * Quote for sending a message
 */
export interface AGIDQuote {
  deliveryFee: number;
  recipientFee: number;
  deliveryAgentIdentityKey: string;
}

/**
 * Handler for incoming messages
 */
export type MessageHandler = (message: AGIDMessage) => Promise<void>;

/**
 * Handler for incoming payments
 * Return true to accept, false to reject (refund)
 */
export type PaymentHandler = (payment: AGIDPayment) => Promise<boolean>;

/**
 * AGIdentity Message Client
 *
 * Provides secure peer-to-peer messaging with automatic encryption.
 * Messages are encrypted using AES-256-GCM with BRC-2 ECDH key derivation.
 *
 * @example
 * ```typescript
 * const client = createMessageClient({
 *   wallet,
 *   enableLogging: true,
 * });
 *
 * await client.initialize();
 *
 * // Send a message (auto-encrypted)
 * await client.sendMessage(recipientKey, 'inbox', { type: 'hello' });
 *
 * // Listen for messages
 * client.onMessage('inbox', async (msg) => {
 *   console.log('Received:', msg.body);
 *   await client.acknowledgeMessage(msg.messageId);
 * });
 * await client.listenForMessages('inbox');
 * ```
 */
export class AGIDMessageClient {
  private messageClient: MessageBoxClient;
  private payClient: PeerPayClient;
  private wallet: AgentWallet;
  private identityKey: string | null = null;
  private messageHandlers = new Map<string, MessageHandler>();
  private paymentHandler: PaymentHandler | null = null;
  private initialized = false;

  constructor(config: AGIDMessageConfig) {
    this.wallet = config.wallet;

    const underlyingWallet = config.wallet.getUnderlyingWallet();
    if (!underlyingWallet) {
      throw new Error('Wallet not initialized');
    }

    // Get defaults from environment config
    const envConfig = getConfig();
    const messageBoxHost = config.messageBoxHost ?? envConfig.messageBoxHost;
    const enableLogging = config.enableLogging ?? envConfig.messageBoxLogging;

    // MessageBoxClient auto-encrypts messages using BRC-2 ECDH
    // With MPC support for threshold signature wallets
    this.messageClient = new MessageBoxClient({
      host: messageBoxHost,
      walletClient: underlyingWallet,
      enableLogging,
      networkPreset: config.networkPreset ?? 'mainnet',
      // MPC options for threshold wallet support
      mpcOptions: {
        onSigningProgress: (info) => {
          if (enableLogging) console.log('[MessageBox MPC]', info);
        },
        onSigningError: (error) => {
          console.error('[MessageBox MPC Error]', error);
        },
        preDerivationTimeout: 30000
      }
    });

    this.payClient = new PeerPayClient({
      messageBoxHost,
      walletClient: underlyingWallet,
      enableLogging,
    });
  }

  /**
   * Initialize the client (required before use)
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    const identity = await this.wallet.getPublicKey({ identityKey: true });
    this.identityKey = identity.publicKey;
    await this.messageClient.init();
    this.initialized = true;
  }

  /**
   * Get the client's identity key
   */
  getIdentityKey(): string {
    if (!this.identityKey) {
      throw new Error('Not initialized');
    }
    return this.identityKey;
  }

  /**
   * Check if initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  // =========================================================================
  // Sending Messages (encryption handled automatically by MessageBoxClient)
  // =========================================================================

  /**
   * Send an encrypted message to a recipient
   * MessageBoxClient auto-encrypts using AES-256-GCM with BRC-2 ECDH
   */
  async sendMessage(
    recipient: string,
    messageBox: string,
    body: string | object,
    options?: { skipEncryption?: boolean; checkPermissions?: boolean }
  ): Promise<{ messageId: string; status: string }> {
    this.ensureInitialized();

    const response = await this.messageClient.sendMessage({
      recipient,
      messageBox,
      body,
      skipEncryption: options?.skipEncryption ?? false,
      checkPermissions: options?.checkPermissions ?? false,
    });

    return { messageId: response.messageId, status: response.status };
  }

  /**
   * Send a live (WebSocket) message with HTTP fallback
   * Waits up to 10 seconds for WebSocket ack before falling back
   */
  async sendLiveMessage(
    recipient: string,
    messageBox: string,
    body: string | object
  ): Promise<{ messageId: string; status: string }> {
    this.ensureInitialized();

    const response = await this.messageClient.sendLiveMessage({
      recipient,
      messageBox,
      body,
    });

    return { messageId: response.messageId, status: response.status };
  }

  /**
   * Send a notification (with auto quote + payment handling)
   * Convenience method for the 'notifications' message box
   */
  async sendNotification(
    recipient: string | string[],
    body: string | object
  ): Promise<unknown> {
    this.ensureInitialized();
    return this.messageClient.sendNotification(recipient, body);
  }

  /**
   * Send to multiple recipients
   */
  async sendToMultiple(
    recipients: string[],
    messageBox: string,
    body: string | object,
    options?: { skipEncryption?: boolean }
  ): Promise<{
    status: 'success' | 'partial' | 'error';
    sent: Array<{ recipient: string; messageId: string }>;
    blocked: string[];
    failed: Array<{ recipient: string; error: string }>;
  }> {
    this.ensureInitialized();

    // Note: The actual API has a typo "sendMesagetoRecepients"
    const result = await (this.messageClient as any).sendMesagetoRecepients({
      recipients,
      messageBox,
      body,
      skipEncryption: options?.skipEncryption ?? false,
    });

    return {
      status: result.status,
      sent: result.sent ?? [],
      blocked: result.blocked ?? [],
      failed: result.failed ?? [],
    };
  }

  // =========================================================================
  // Receiving Messages (auto-decrypted by MessageBoxClient)
  // =========================================================================

  /**
   * Register a handler for a specific message box
   */
  onMessage(messageBox: string, handler: MessageHandler): void {
    this.messageHandlers.set(messageBox, handler);
  }

  /**
   * Remove a message handler
   */
  offMessage(messageBox: string): void {
    this.messageHandlers.delete(messageBox);
  }

  /**
   * Start listening for live messages on a message box
   * Messages are automatically decrypted
   */
  async listenForMessages(messageBox: string): Promise<void> {
    this.ensureInitialized();

    await this.messageClient.listenForLiveMessages({
      messageBox,
      onMessage: async (rawMessage: unknown) => {
        const raw = rawMessage as Record<string, unknown>;
        const message: AGIDMessage = {
          messageId: raw.messageId as string,
          sender: raw.sender as string,
          body: raw.body as string | Record<string, unknown>,
          createdAt: (raw.created_at ?? raw.createdAt) as string,
          messageBox,
        };
        const handler = this.messageHandlers.get(messageBox);
        if (handler) {
          await handler(message);
        }
      },
    });
  }

  /**
   * List pending messages in a message box (auto-decrypted)
   */
  async listMessages(
    messageBox: string,
    options?: { acceptPayments?: boolean }
  ): Promise<AGIDMessage[]> {
    this.ensureInitialized();

    const rawMessages = await this.messageClient.listMessages({
      messageBox,
      acceptPayments: options?.acceptPayments ?? true,
    });

    return rawMessages.map((raw: unknown) => {
      const r = raw as Record<string, unknown>;
      return {
        messageId: r.messageId as string,
        sender: r.sender as string,
        body: r.body as string | Record<string, unknown>,
        createdAt: (r.created_at ?? r.createdAt) as string,
        messageBox,
      };
    });
  }

  /**
   * Acknowledge (delete) processed messages
   */
  async acknowledgeMessage(messageIds: string | string[]): Promise<void> {
    this.ensureInitialized();
    const ids = Array.isArray(messageIds) ? messageIds : [messageIds];
    await this.messageClient.acknowledgeMessage({ messageIds: ids });
  }

  // =========================================================================
  // Payments
  // =========================================================================

  /**
   * Register a payment handler
   * Return true to accept the payment, false to reject (refund minus fee)
   */
  onPayment(handler: PaymentHandler): void {
    this.paymentHandler = handler;
  }

  /**
   * Remove the payment handler
   */
  offPayment(): void {
    this.paymentHandler = null;
  }

  /**
   * Send a payment to a recipient
   */
  async sendPayment(recipient: string, amount: number): Promise<void> {
    this.ensureInitialized();
    await this.payClient.sendPayment({ recipient, amount });
  }

  /**
   * Send a live payment (WebSocket with HTTP fallback)
   */
  async sendLivePayment(recipient: string, amount: number): Promise<void> {
    this.ensureInitialized();
    await this.payClient.sendLivePayment({ recipient, amount });
  }

  /**
   * Start listening for incoming payments
   */
  async listenForPayments(): Promise<void> {
    this.ensureInitialized();

    await this.payClient.listenForLivePayments({
      onPayment: async (payment: unknown) => {
        const p = payment as Record<string, unknown>;
        const token = p.token as Record<string, unknown> | undefined;

        const agidPayment: AGIDPayment = {
          messageId: p.messageId as string,
          sender: p.sender as string,
          amount: (token?.amount as number) ?? 0,
          token: token,
        };

        let accepted = true;
        if (this.paymentHandler) {
          accepted = await this.paymentHandler(agidPayment);
        }

        if (accepted) {
          await this.payClient.acceptPayment(payment as any);
        } else {
          await this.payClient.rejectPayment(payment as any);
        }
      },
    });
  }

  /**
   * Accept an incoming payment
   */
  async acceptPayment(payment: AGIDPayment): Promise<void> {
    this.ensureInitialized();
    await this.payClient.acceptPayment({
      messageId: payment.messageId,
      sender: payment.sender,
      token: payment.token,
    } as any);
  }

  /**
   * Reject an incoming payment (refunds minus fee)
   */
  async rejectPayment(payment: AGIDPayment): Promise<void> {
    this.ensureInitialized();
    await this.payClient.rejectPayment({
      messageId: payment.messageId,
      sender: payment.sender,
      token: payment.token,
    } as any);
  }

  /**
   * List pending incoming payments
   */
  async listIncomingPayments(): Promise<AGIDPayment[]> {
    this.ensureInitialized();
    const payments = await this.payClient.listIncomingPayments();

    return payments.map((p: unknown) => {
      const payment = p as Record<string, unknown>;
      const token = payment.token as Record<string, unknown> | undefined;
      return {
        messageId: payment.messageId as string,
        sender: payment.sender as string,
        amount: (token?.amount as number) ?? 0,
        token: token,
      };
    });
  }

  // =========================================================================
  // Permissions
  // =========================================================================

  /**
   * Set permission for a message box
   * @param recipientFee -1 to block, 0 to always allow, >0 for satoshi fee
   */
  async setPermission(
    messageBox: string,
    options: { sender?: string; recipientFee: number }
  ): Promise<void> {
    this.ensureInitialized();
    await this.messageClient.setMessageBoxPermission({
      messageBox,
      sender: options.sender,
      recipientFee: options.recipientFee,
    });
  }

  /**
   * Get permission for a message box
   */
  async getPermission(
    recipient: string,
    messageBox: string,
    sender?: string
  ): Promise<AGIDPermission | null> {
    this.ensureInitialized();
    const result = await this.messageClient.getMessageBoxPermission({
      recipient,
      messageBox,
      sender,
    });
    return result as AGIDPermission | null;
  }

  /**
   * List all permissions
   */
  async listPermissions(messageBox?: string): Promise<AGIDPermission[]> {
    this.ensureInitialized();
    const result = await this.messageClient.listMessageBoxPermissions({
      messageBox,
    });
    return result as AGIDPermission[];
  }

  /**
   * Get a quote for sending a message
   */
  async getQuote(recipient: string, messageBox: string): Promise<AGIDQuote> {
    this.ensureInitialized();
    const result = await this.messageClient.getMessageBoxQuote({
      recipient,
      messageBox,
    });
    return result as AGIDQuote;
  }

  /**
   * Allow notifications from a peer
   */
  async allowNotificationsFrom(
    peerIdentityKey: string,
    recipientFee?: number
  ): Promise<void> {
    this.ensureInitialized();
    await this.messageClient.allowNotificationsFromPeer(
      peerIdentityKey,
      recipientFee ?? 0
    );
  }

  /**
   * Block notifications from a peer
   */
  async denyNotificationsFrom(peerIdentityKey: string): Promise<void> {
    this.ensureInitialized();
    await this.messageClient.denyNotificationsFromPeer(peerIdentityKey);
  }

  /**
   * Check notification permission for a peer
   */
  async checkPeerPermission(peerIdentityKey: string): Promise<AGIDPermission | null> {
    this.ensureInitialized();
    const result = await this.messageClient.checkPeerNotificationStatus(peerIdentityKey);
    return result as AGIDPermission | null;
  }

  // =========================================================================
  // WebSocket Room Management
  // =========================================================================

  /**
   * Join a WebSocket room for live updates
   */
  async joinRoom(messageBox: string): Promise<void> {
    this.ensureInitialized();
    await this.messageClient.joinRoom(messageBox);
  }

  /**
   * Leave a WebSocket room
   */
  async leaveRoom(messageBox: string): Promise<void> {
    this.ensureInitialized();
    await this.messageClient.leaveRoom(messageBox);
  }

  /**
   * Get currently joined rooms
   */
  getJoinedRooms(): Set<string> {
    return this.messageClient.getJoinedRooms();
  }

  /**
   * Disconnect WebSocket
   */
  async disconnect(): Promise<void> {
    if (this.initialized) {
      await this.messageClient.disconnectWebSocket();
    }
  }

  // =========================================================================
  // Overlay Network (Host Advertisement)
  // =========================================================================

  /**
   * Anoint a MessageBox host for this identity
   * Required for overlay-based message routing
   * Broadcasts a signed advertisement to the tm_messagebox topic
   */
  async anointHost(host: string): Promise<{ txid: string }> {
    this.ensureInitialized();
    return this.messageClient.anointHost(host);
  }

  /**
   * Resolve the MessageBox host for a recipient
   * Uses overlay network lookup
   */
  async resolveHostForRecipient(identityKey: string): Promise<string> {
    this.ensureInitialized();
    return this.messageClient.resolveHostForRecipient(identityKey);
  }

  // =========================================================================
  // Private Helpers
  // =========================================================================

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('MessageClient not initialized. Call initialize() first.');
    }
  }
}

/**
 * Create a new AGIDMessageClient
 */
export function createMessageClient(config: AGIDMessageConfig): AGIDMessageClient {
  return new AGIDMessageClient(config);
}
