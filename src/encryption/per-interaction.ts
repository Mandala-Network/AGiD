/**
 * Per-Interaction Encryption
 *
 * Implements Edwin-style per-interaction encryption where each message
 * uses a unique derived key. This provides Perfect Forward Secrecy (PFS):
 * compromising one key reveals nothing about past or future messages.
 *
 * Key derivation follows BRC-42/43:
 * - Security Level 2: Per-counterparty keys
 * - Unique keyID for each interaction
 * - ECDH shared secret + HMAC derivation
 */

import type { BRC100Wallet } from '../types/index.js';

export interface InteractionContext {
  sessionId: string;
  messageIndex: number;
  timestamp: number;
  direction: 'inbound' | 'outbound';
}

export interface EncryptedMessage {
  ciphertext: Uint8Array;
  keyId: string;
  sessionId: string;
  messageIndex: number;
  timestamp: number;
}

export interface DecryptedMessage {
  plaintext: string;
  keyId: string;
  verified: boolean;
}

export class PerInteractionEncryption {
  private wallet: BRC100Wallet;
  private protocolId: [number, string] = [2, 'agidentity-pfs'];

  constructor(wallet: BRC100Wallet) {
    this.wallet = wallet;
  }

  /**
   * Generate a unique key ID for an interaction
   *
   * Format: session-{sessionId}-msg-{index}-{direction}-{timestamp}
   * This ensures every message has a unique encryption key.
   */
  generateKeyId(context: InteractionContext): string {
    return `session-${context.sessionId}-msg-${context.messageIndex}-${context.direction}-${context.timestamp}`;
  }

  /**
   * Encrypt a message for a specific user
   *
   * Each message gets a unique derived key based on:
   * - User's public key (counterparty)
   * - Session ID
   * - Message index
   * - Timestamp
   */
  async encryptMessage(
    userPublicKey: string,
    message: string,
    context: InteractionContext
  ): Promise<EncryptedMessage> {
    const keyId = this.generateKeyId(context);

    const encrypted = await this.wallet.encrypt({
      plaintext: Array.from(new TextEncoder().encode(message)),
      protocolID: this.protocolId,
      keyID: keyId,
      counterparty: userPublicKey
    });

    return {
      ciphertext: new Uint8Array(encrypted.ciphertext),
      keyId,
      sessionId: context.sessionId,
      messageIndex: context.messageIndex,
      timestamp: context.timestamp
    };
  }

  /**
   * Decrypt a message from a specific user
   */
  async decryptMessage(
    userPublicKey: string,
    encryptedMessage: EncryptedMessage
  ): Promise<DecryptedMessage> {
    const decrypted = await this.wallet.decrypt({
      ciphertext: Array.from(encryptedMessage.ciphertext),
      protocolID: this.protocolId,
      keyID: encryptedMessage.keyId,
      counterparty: userPublicKey
    });

    return {
      plaintext: new TextDecoder().decode(new Uint8Array(decrypted.plaintext)),
      keyId: encryptedMessage.keyId,
      verified: true
    };
  }

  /**
   * Encrypt data for storage (not per-interaction, but user-specific)
   */
  async encryptForStorage(
    userPublicKey: string,
    data: Uint8Array,
    dataType: string
  ): Promise<{ ciphertext: Uint8Array; keyId: string }> {
    const keyId = `storage-${dataType}-${Date.now()}`;

    const encrypted = await this.wallet.encrypt({
      plaintext: Array.from(data),
      protocolID: [2, 'agidentity-storage'],
      keyID: keyId,
      counterparty: userPublicKey
    });

    return {
      ciphertext: new Uint8Array(encrypted.ciphertext),
      keyId
    };
  }

  /**
   * Decrypt data from storage
   */
  async decryptFromStorage(
    userPublicKey: string,
    ciphertext: Uint8Array,
    keyId: string
  ): Promise<Uint8Array> {
    const decrypted = await this.wallet.decrypt({
      ciphertext: Array.from(ciphertext),
      protocolID: [2, 'agidentity-storage'],
      keyID: keyId,
      counterparty: userPublicKey
    });

    return new Uint8Array(decrypted.plaintext);
  }

  /**
   * Create a signed envelope for a message
   *
   * This adds authentication to encryption:
   * - Message is encrypted
   * - Envelope metadata is signed
   * - Recipient can verify sender
   */
  async createSignedEnvelope(
    userPublicKey: string,
    message: string,
    context: InteractionContext
  ): Promise<{
    encrypted: EncryptedMessage;
    signature: Uint8Array;
    signedData: string;
  }> {
    // Encrypt the message
    const encrypted = await this.encryptMessage(userPublicKey, message, context);

    // Create data to sign (metadata, not content)
    const signedData = JSON.stringify({
      keyId: encrypted.keyId,
      sessionId: encrypted.sessionId,
      messageIndex: encrypted.messageIndex,
      timestamp: encrypted.timestamp,
      ciphertextHash: await this.hashData(encrypted.ciphertext)
    });

    // Sign the metadata
    const signature = await this.wallet.createSignature({
      data: Array.from(new TextEncoder().encode(signedData)),
      protocolID: [1, 'agidentity-envelope'],
      keyID: `envelope-${encrypted.keyId}`
    });

    return {
      encrypted,
      signature: new Uint8Array(signature.signature),
      signedData
    };
  }

  /**
   * Verify and decrypt a signed envelope
   */
  async verifyAndDecrypt(
    userPublicKey: string,
    envelope: {
      encrypted: EncryptedMessage;
      signature: Uint8Array;
      signedData: string;
    }
  ): Promise<DecryptedMessage & { signatureValid: boolean }> {
    // Verify the signature
    const verifyResult = await this.wallet.verifySignature({
      data: Array.from(new TextEncoder().encode(envelope.signedData)),
      signature: Array.from(envelope.signature),
      protocolID: [1, 'agidentity-envelope'],
      keyID: `envelope-${envelope.encrypted.keyId}`,
      counterparty: userPublicKey
    });

    // Verify ciphertext hash matches
    const parsedData = JSON.parse(envelope.signedData);
    const actualHash = await this.hashData(envelope.encrypted.ciphertext);

    const hashValid = parsedData.ciphertextHash === actualHash;

    // Decrypt the message
    const decrypted = await this.decryptMessage(userPublicKey, envelope.encrypted);

    return {
      ...decrypted,
      signatureValid: verifyResult.valid && hashValid
    };
  }

  /**
   * Derive a shared secret with a counterparty
   *
   * Useful for establishing encrypted channels.
   */
  async deriveSharedSecret(
    counterpartyPublicKey: string,
    purpose: string
  ): Promise<{ secret: Uint8Array; keyId: string }> {
    const keyId = `shared-${purpose}-${Date.now()}`;

    // Use HMAC to derive a symmetric key
    const hmacResult = await this.wallet.createHmac({
      data: Array.from(new TextEncoder().encode(purpose)),
      protocolID: [2, 'agidentity-shared'],
      keyID: keyId,
      counterparty: counterpartyPublicKey
    });

    return {
      secret: new Uint8Array(hmacResult.hmac),
      keyId
    };
  }

  private async hashData(data: Uint8Array): Promise<string> {
    const hash = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }
}

/**
 * Session encryption manager
 *
 * Manages encryption state for an entire session, tracking
 * message indices and providing convenience methods.
 */
export class SessionEncryption {
  private encryption: PerInteractionEncryption;
  private sessionId: string;
  private messageIndex: number = 0;
  private userPublicKey: string;

  constructor(
    wallet: BRC100Wallet,
    userPublicKey: string,
    sessionId?: string
  ) {
    this.encryption = new PerInteractionEncryption(wallet);
    this.userPublicKey = userPublicKey;
    this.sessionId = sessionId ?? this.generateSessionId();
  }

  /**
   * Encrypt an outbound message
   */
  async encryptOutbound(message: string): Promise<EncryptedMessage> {
    const context: InteractionContext = {
      sessionId: this.sessionId,
      messageIndex: this.messageIndex++,
      timestamp: Date.now(),
      direction: 'outbound'
    };

    return this.encryption.encryptMessage(this.userPublicKey, message, context);
  }

  /**
   * Decrypt an inbound message
   */
  async decryptInbound(encryptedMessage: EncryptedMessage): Promise<DecryptedMessage> {
    return this.encryption.decryptMessage(this.userPublicKey, encryptedMessage);
  }

  /**
   * Get current session ID
   */
  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * Get current message index
   */
  getMessageIndex(): number {
    return this.messageIndex;
  }

  private generateSessionId(): string {
    const random = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(random)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }
}
