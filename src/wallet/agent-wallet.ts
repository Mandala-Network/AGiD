/**
 * Agent Wallet
 *
 * BRC-100 compliant wallet for the AI agent.
 * The agent has its own identity and can sign messages, but cannot access user keys.
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
  AgentWalletConfig,
} from '../types/index.js';

export class AgentWallet implements BRC100Wallet {
  private config: AgentWalletConfig;
  private initialized: boolean = false;
  private identityPublicKey: string | null = null;

  constructor(config: AgentWalletConfig) {
    this.config = config;
  }

  /**
   * Initialize the agent wallet
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    if (this.config.type === 'external' && this.config.externalWallet) {
      // Use external wallet directly
      const result = await this.config.externalWallet.getPublicKey({ identityKey: true });
      this.identityPublicKey = result.publicKey;
    } else if (this.config.type === 'privateKey' && this.config.privateKeyWif) {
      // Initialize from private key WIF
      // This would use @bsv/sdk to derive the public key
      this.identityPublicKey = await this.derivePublicKeyFromWif(this.config.privateKeyWif);
    } else if (this.config.type === 'mnemonic' && this.config.mnemonic) {
      // Initialize from mnemonic
      // This would use @bsv/wallet-toolbox
      this.identityPublicKey = await this.derivePublicKeyFromMnemonic(this.config.mnemonic);
    } else {
      throw new Error('Invalid wallet configuration');
    }

    this.initialized = true;
  }

  /**
   * Get the agent's public key or a derived key
   */
  async getPublicKey(args: GetPublicKeyArgs): Promise<GetPublicKeyResult> {
    await this.ensureInitialized();

    if (args.identityKey) {
      return { publicKey: this.identityPublicKey! };
    }

    if (args.protocolID && args.keyID) {
      // Derive child key using BRC-42
      const derivedKey = await this.deriveChildKey(
        args.protocolID,
        args.keyID,
        args.counterparty
      );
      return { publicKey: derivedKey };
    }

    return { publicKey: this.identityPublicKey! };
  }

  /**
   * Encrypt data using BRC-42 derived key
   */
  async encrypt(args: EncryptArgs): Promise<EncryptResult> {
    await this.ensureInitialized();

    const plaintext = args.plaintext instanceof Uint8Array
      ? args.plaintext
      : new Uint8Array(args.plaintext);

    // Derive encryption key
    const encryptionKey = await this.deriveEncryptionKey(
      args.protocolID,
      args.keyID,
      args.counterparty
    );

    // Encrypt with AES-256-GCM
    const ciphertext = await this.aesEncrypt(plaintext, encryptionKey);

    return { ciphertext: Array.from(ciphertext) };
  }

  /**
   * Decrypt data using BRC-42 derived key
   */
  async decrypt(args: DecryptArgs): Promise<DecryptResult> {
    await this.ensureInitialized();

    const ciphertext = args.ciphertext instanceof Uint8Array
      ? args.ciphertext
      : new Uint8Array(args.ciphertext);

    // Derive decryption key
    const decryptionKey = await this.deriveEncryptionKey(
      args.protocolID,
      args.keyID,
      args.counterparty
    );

    // Decrypt with AES-256-GCM
    const plaintext = await this.aesDecrypt(ciphertext, decryptionKey);

    return { plaintext: Array.from(plaintext) };
  }

  /**
   * Create a digital signature
   */
  async createSignature(args: CreateSignatureArgs): Promise<CreateSignatureResult> {
    await this.ensureInitialized();

    const data = args.data instanceof Uint8Array
      ? args.data
      : new Uint8Array(args.data);

    // Derive signing key
    const signingKey = await this.deriveSigningKey(
      args.protocolID,
      args.keyID,
      args.counterparty
    );

    // Sign with ECDSA
    const signature = await this.ecdsaSign(data, signingKey);

    return { signature: Array.from(signature) };
  }

  /**
   * Verify a digital signature
   */
  async verifySignature(args: VerifySignatureArgs): Promise<VerifySignatureResult> {
    await this.ensureInitialized();

    const data = args.data instanceof Uint8Array
      ? args.data
      : new Uint8Array(args.data);

    const signature = args.signature instanceof Uint8Array
      ? args.signature
      : new Uint8Array(args.signature);

    // Derive verification key
    const verificationKey = await this.deriveSigningKey(
      args.protocolID,
      args.keyID,
      args.counterparty
    );

    // Verify with ECDSA
    const valid = await this.ecdsaVerify(data, signature, verificationKey);

    return { valid };
  }

  /**
   * Create HMAC
   */
  async createHmac(args: CreateHmacArgs): Promise<CreateHmacResult> {
    await this.ensureInitialized();

    const data = args.data instanceof Uint8Array
      ? args.data
      : new Uint8Array(args.data);

    // Derive HMAC key
    const hmacKey = await this.deriveHmacKey(
      args.protocolID,
      args.keyID,
      args.counterparty
    );

    // Create HMAC-SHA256
    const hmac = await this.hmacSha256(data, hmacKey);

    return { hmac: Array.from(hmac) };
  }

  /**
   * Verify HMAC
   */
  async verifyHmac(args: VerifyHmacArgs): Promise<VerifyHmacResult> {
    await this.ensureInitialized();

    const data = args.data instanceof Uint8Array
      ? args.data
      : new Uint8Array(args.data);

    const expectedHmac = args.hmac instanceof Uint8Array
      ? args.hmac
      : new Uint8Array(args.hmac);

    // Derive HMAC key
    const hmacKey = await this.deriveHmacKey(
      args.protocolID,
      args.keyID,
      args.counterparty
    );

    // Create and compare HMAC
    const actualHmac = await this.hmacSha256(data, hmacKey);
    const valid = this.constantTimeCompare(actualHmac, expectedHmac);

    return { valid };
  }

  /**
   * Create a blockchain transaction
   */
  async createAction(args: CreateActionArgs): Promise<CreateActionResult> {
    await this.ensureInitialized();

    // Build and sign transaction
    // This would use @bsv/sdk Transaction class
    const txid = await this.buildAndBroadcastTransaction(args);

    return { txid };
  }

  /**
   * Acquire a certificate
   */
  async acquireCertificate(_args: AcquireCertificateArgs): Promise<AcquireCertificateResult> {
    await this.ensureInitialized();

    // Request certificate from certifier
    // This would implement BRC-52 certificate acquisition
    throw new Error('Certificate acquisition not yet implemented');
  }

  /**
   * List certificates
   */
  async listCertificates(_args: ListCertificatesArgs): Promise<ListCertificatesResult> {
    await this.ensureInitialized();

    // Query certificate storage
    // This would implement BRC-52 certificate listing
    return { certificates: [] };
  }

  /**
   * Get network
   */
  async getNetwork(): Promise<'mainnet' | 'testnet'> {
    // Return configured network
    return 'mainnet';
  }

  /**
   * Get blockchain height
   */
  async getHeight(): Promise<number> {
    // Query blockchain for current height
    // This would use a BSV node or service
    throw new Error('getHeight not yet implemented');
  }

  /**
   * Check if authenticated
   */
  async isAuthenticated(): Promise<boolean> {
    return this.initialized;
  }

  // =========================================================================
  // Private Helper Methods
  // =========================================================================

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  private async derivePublicKeyFromWif(wif: string): Promise<string> {
    // Use @bsv/sdk to derive public key from WIF
    // Placeholder implementation
    const { PrivateKey } = await import('@bsv/sdk');
    const privateKey = PrivateKey.fromWif(wif);
    return privateKey.toPublicKey().toString();
  }

  private async derivePublicKeyFromMnemonic(_mnemonic: string): Promise<string> {
    // Use @bsv/wallet-toolbox to derive from mnemonic
    // Placeholder implementation
    throw new Error('Mnemonic derivation not yet implemented');
  }

  private async deriveChildKey(
    protocolID: [number, string],
    keyID: string,
    _counterparty?: string
  ): Promise<string> {
    // Implement BRC-42 key derivation
    // 1. Get counterparty public key (or use self)
    // 2. Compute ECDH shared secret
    // 3. Create invoice number from protocolID and keyID
    // 4. HMAC the shared secret with invoice number
    // 5. Derive child key

    const invoiceNumber = `${protocolID[0]}-${protocolID[1]}-${keyID}`;

    // Placeholder - actual implementation would use @bsv/sdk
    const hash = await this.sha256(new TextEncoder().encode(invoiceNumber));
    return Buffer.from(hash).toString('hex');
  }

  private async deriveEncryptionKey(
    protocolID: [number, string],
    keyID: string,
    counterparty?: string
  ): Promise<Uint8Array> {
    // Derive 32-byte encryption key using BRC-42
    const childKey = await this.deriveChildKey(protocolID, keyID, counterparty);
    return this.sha256(new TextEncoder().encode(childKey));
  }

  private async deriveSigningKey(
    protocolID: [number, string],
    keyID: string,
    counterparty?: string
  ): Promise<Uint8Array> {
    // Derive signing key (private key scalar)
    const childKey = await this.deriveChildKey(protocolID, keyID, counterparty);
    return this.sha256(new TextEncoder().encode(`sign:${childKey}`));
  }

  private async deriveHmacKey(
    protocolID: [number, string],
    keyID: string,
    counterparty?: string
  ): Promise<Uint8Array> {
    // Derive HMAC key
    const childKey = await this.deriveChildKey(protocolID, keyID, counterparty);
    return this.sha256(new TextEncoder().encode(`hmac:${childKey}`));
  }

  private async aesEncrypt(plaintext: Uint8Array, key: Uint8Array): Promise<Uint8Array> {
    // AES-256-GCM encryption
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      key,
      { name: 'AES-GCM' },
      false,
      ['encrypt']
    );

    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      cryptoKey,
      plaintext
    );

    // Prepend IV to ciphertext
    const result = new Uint8Array(iv.length + ciphertext.byteLength);
    result.set(iv);
    result.set(new Uint8Array(ciphertext), iv.length);

    return result;
  }

  private async aesDecrypt(ciphertext: Uint8Array, key: Uint8Array): Promise<Uint8Array> {
    // AES-256-GCM decryption
    const iv = ciphertext.slice(0, 12);
    const data = ciphertext.slice(12);

    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      key,
      { name: 'AES-GCM' },
      false,
      ['decrypt']
    );

    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      cryptoKey,
      data
    );

    return new Uint8Array(plaintext);
  }

  private async ecdsaSign(data: Uint8Array, privateKey: Uint8Array): Promise<Uint8Array> {
    // ECDSA signing with secp256k1
    // This would use @bsv/sdk
    // Placeholder - returns SHA256 of data + key
    const combined = new Uint8Array(data.length + privateKey.length);
    combined.set(data);
    combined.set(privateKey, data.length);
    return this.sha256(combined);
  }

  private async ecdsaVerify(
    _data: Uint8Array,
    _signature: Uint8Array,
    _publicKey: Uint8Array
  ): Promise<boolean> {
    // ECDSA verification with secp256k1
    // This would use @bsv/sdk
    // Placeholder
    return true;
  }

  private async hmacSha256(data: Uint8Array, key: Uint8Array): Promise<Uint8Array> {
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      key,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const signature = await crypto.subtle.sign('HMAC', cryptoKey, data);
    return new Uint8Array(signature);
  }

  private async sha256(data: Uint8Array): Promise<Uint8Array> {
    const hash = await crypto.subtle.digest('SHA-256', data);
    return new Uint8Array(hash);
  }

  private constantTimeCompare(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;

    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a[i] ^ b[i];
    }

    return result === 0;
  }

  private async buildAndBroadcastTransaction(_args: CreateActionArgs): Promise<string> {
    // Build and broadcast transaction using @bsv/sdk
    // Placeholder implementation
    throw new Error('Transaction creation not yet implemented');
  }
}

/**
 * Create and initialize an agent wallet
 */
export async function createAgentWallet(config: AgentWalletConfig): Promise<AgentWallet> {
  const wallet = new AgentWallet(config);
  await wallet.initialize();
  return wallet;
}
