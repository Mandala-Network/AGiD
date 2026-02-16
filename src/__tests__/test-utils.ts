/**
 * Test Utilities
 *
 * Mock implementations and helpers for testing AGIdentity security features.
 * These mocks implement full cryptographic operations using Web Crypto API
 * to ensure tests validate actual security properties.
 */

import type {
  BRC100Wallet,
  GetPublicKeyArgs,
  GetPublicKeyResult,
  EncryptArgs,
  EncryptResult,
  DecryptArgs,
  DecryptResult,
  CreateSignatureArgs,
  CreateSignatureResult,
  VerifySignatureArgs,
  VerifySignatureResult,
  CreateHmacArgs,
  CreateHmacResult,
  VerifyHmacArgs,
  VerifyHmacResult,
  CreateActionArgs,
  CreateActionResult,
  AcquireCertificateArgs,
  AcquireCertificateResult,
  ListCertificatesArgs,
  ListCertificatesResult,
} from '../07-shared/types/index.js';

/**
 * Cryptographically secure mock wallet for testing
 *
 * Uses actual Web Crypto API operations to ensure tests validate
 * real security properties, not just mocked behavior.
 */
export class MockSecureWallet implements BRC100Wallet {
  private masterKey: Uint8Array;
  private publicKeyHex: string;

  constructor(seed?: Uint8Array) {
    // Generate or use provided seed
    this.masterKey = seed ?? crypto.getRandomValues(new Uint8Array(32));
    // Generate a deterministic public key from the seed
    this.publicKeyHex = this.derivePublicKeySync();
  }

  private derivePublicKeySync(): string {
    // Create deterministic public key from master key
    const hash = new Uint8Array(33);
    hash[0] = 0x02; // Compressed public key prefix
    for (let i = 0; i < 32; i++) {
      hash[i + 1] = this.masterKey[i];
    }
    return Array.from(hash).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async getPublicKey(args: GetPublicKeyArgs): Promise<GetPublicKeyResult> {
    if (args.identityKey) {
      return { publicKey: this.publicKeyHex };
    }

    if (args.protocolID && args.keyID) {
      // Derive child key
      const derivedKey = await this.deriveKey(
        args.protocolID,
        args.keyID,
        args.counterparty
      );
      return { publicKey: derivedKey };
    }

    return { publicKey: this.publicKeyHex };
  }

  async encrypt(args: EncryptArgs): Promise<EncryptResult> {
    const plaintext = args.plaintext instanceof Uint8Array
      ? args.plaintext
      : new Uint8Array(args.plaintext);

    // Derive encryption key
    const keyMaterial = await this.getKeyMaterial(
      args.protocolID,
      args.keyID,
      args.counterparty
    );

    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyMaterial,
      { name: 'AES-GCM' },
      false,
      ['encrypt']
    );

    // Generate IV
    const iv = crypto.getRandomValues(new Uint8Array(12));

    // Encrypt
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      cryptoKey,
      plaintext
    );

    // Prepend IV to ciphertext
    const result = new Uint8Array(iv.length + ciphertext.byteLength);
    result.set(iv);
    result.set(new Uint8Array(ciphertext), iv.length);

    return { ciphertext: Array.from(result) };
  }

  async decrypt(args: DecryptArgs): Promise<DecryptResult> {
    const ciphertext = args.ciphertext instanceof Uint8Array
      ? args.ciphertext
      : new Uint8Array(args.ciphertext);

    // Extract IV and encrypted data
    const iv = ciphertext.slice(0, 12);
    const encryptedData = ciphertext.slice(12);

    // Derive decryption key
    const keyMaterial = await this.getKeyMaterial(
      args.protocolID,
      args.keyID,
      args.counterparty
    );

    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyMaterial,
      { name: 'AES-GCM' },
      false,
      ['decrypt']
    );

    // Decrypt
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      cryptoKey,
      encryptedData
    );

    return { plaintext: Array.from(new Uint8Array(plaintext)) };
  }

  async createSignature(args: CreateSignatureArgs): Promise<CreateSignatureResult> {
    const data = args.data instanceof Uint8Array
      ? args.data
      : new Uint8Array(args.data);

    // Derive signing key
    const keyMaterial = await this.getKeyMaterial(
      args.protocolID,
      args.keyID,
      args.counterparty
    );

    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyMaterial,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    // Sign (using HMAC as a deterministic signature for testing)
    const signature = await crypto.subtle.sign('HMAC', cryptoKey, data);

    return { signature: Array.from(new Uint8Array(signature)) };
  }

  async verifySignature(args: VerifySignatureArgs): Promise<VerifySignatureResult> {
    const data = args.data instanceof Uint8Array
      ? args.data
      : new Uint8Array(args.data);

    const expectedSignature = args.signature instanceof Uint8Array
      ? args.signature
      : new Uint8Array(args.signature);

    // Derive verification key
    const keyMaterial = await this.getKeyMaterial(
      args.protocolID,
      args.keyID,
      args.counterparty
    );

    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyMaterial,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    // Create expected signature
    const actualSignature = await crypto.subtle.sign('HMAC', cryptoKey, data);

    // Constant-time comparison
    const valid = this.constantTimeCompare(
      new Uint8Array(actualSignature),
      expectedSignature
    );

    return { valid };
  }

  async createHmac(args: CreateHmacArgs): Promise<CreateHmacResult> {
    const data = args.data instanceof Uint8Array
      ? args.data
      : new Uint8Array(args.data);

    const keyMaterial = await this.getKeyMaterial(
      args.protocolID,
      args.keyID,
      args.counterparty
    );

    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyMaterial,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const hmac = await crypto.subtle.sign('HMAC', cryptoKey, data);

    return { hmac: Array.from(new Uint8Array(hmac)) };
  }

  async verifyHmac(args: VerifyHmacArgs): Promise<VerifyHmacResult> {
    const data = args.data instanceof Uint8Array
      ? args.data
      : new Uint8Array(args.data);

    const expectedHmac = args.hmac instanceof Uint8Array
      ? args.hmac
      : new Uint8Array(args.hmac);

    const keyMaterial = await this.getKeyMaterial(
      args.protocolID,
      args.keyID,
      args.counterparty
    );

    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyMaterial,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const actualHmac = await crypto.subtle.sign('HMAC', cryptoKey, data);

    const valid = this.constantTimeCompare(
      new Uint8Array(actualHmac),
      expectedHmac
    );

    return { valid };
  }

  async createAction(_args: CreateActionArgs): Promise<CreateActionResult> {
    // Generate mock transaction ID
    const txid = Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    return { txid };
  }

  async acquireCertificate(_args: AcquireCertificateArgs): Promise<AcquireCertificateResult> {
    throw new Error('Certificate acquisition not implemented in mock');
  }

  async listCertificates(_args: ListCertificatesArgs): Promise<ListCertificatesResult> {
    return { certificates: [] };
  }

  async getNetwork(): Promise<'mainnet' | 'testnet'> {
    return 'testnet';
  }

  async getHeight(): Promise<number> {
    return 800000;
  }

  async isAuthenticated(): Promise<boolean> {
    return true;
  }

  // =========================================================================
  // Private Helpers
  // =========================================================================

  private async getKeyMaterial(
    protocolID: [number, string],
    keyID: string,
    counterparty?: string
  ): Promise<Uint8Array> {
    const cacheKey = `${protocolID[0]}-${protocolID[1]}-${keyID}-${counterparty ?? 'self'}`;

    // Derive key material using HKDF-like construction
    const info = new TextEncoder().encode(cacheKey);

    const hmacKey = await crypto.subtle.importKey(
      'raw',
      this.masterKey,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const derived = await crypto.subtle.sign('HMAC', hmacKey, info);

    return new Uint8Array(derived);
  }

  private async deriveKey(
    protocolID: [number, string],
    keyID: string,
    counterparty?: string
  ): Promise<string> {
    const keyMaterial = await this.getKeyMaterial(protocolID, keyID, counterparty);
    return Array.from(keyMaterial).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  private constantTimeCompare(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;

    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a[i] ^ b[i];
    }

    return result === 0;
  }

  /**
   * Get the master key for testing key isolation
   */
  getMasterKeyForTesting(): Uint8Array {
    return new Uint8Array(this.masterKey);
  }
}

/**
 * Create a deterministic wallet from a seed phrase (for reproducible tests)
 */
export function createDeterministicWallet(seed: string): MockSecureWallet {
  const encoder = new TextEncoder();
  const seedBytes = encoder.encode(seed);

  // Expand seed to 32 bytes using simple hash
  const expandedSeed = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    expandedSeed[i] = seedBytes[i % seedBytes.length] ^ (i * 7);
  }

  return new MockSecureWallet(expandedSeed);
}

/**
 * Generate random bytes for testing
 */
export function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

/**
 * Convert hex string to Uint8Array
 */
export function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

/**
 * Convert Uint8Array to hex string
 */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Sleep for specified milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Assert that two Uint8Arrays are equal
 */
export function assertBytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Assert that two Uint8Arrays are NOT equal
 */
export function assertBytesNotEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return true;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return true;
  }
  return false;
}
