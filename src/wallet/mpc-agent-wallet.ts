/**
 * MPC Agent Wallet
 *
 * BRC-100 wallet interface for MPC (Multi-Party Computation) threshold signatures.
 * No single party has access to the full private key - signing requires
 * coordination between multiple cosigner servers.
 *
 * This provides enhanced security for AI agents: even if the agent is
 * compromised, the attacker cannot extract the private key.
 *
 * NOTE: This is an interface implementation. The actual MPC modules
 * (MPCWallet, MPCClient, etc.) are external and must be provided via
 * dependency injection or installed separately when available.
 *
 * @see MPC-DEV/wallet-toolbox-mpc for the actual MPC implementation
 */

// Standard wallet-toolbox imports
import { StorageKnex } from '@bsv/wallet-toolbox'
import type { Chain } from '@bsv/wallet-toolbox'
import type { WalletInterface } from '@bsv/sdk'
import { MessageBoxClient, PeerPayClient } from '@bsv/message-box-client'

// Local type imports
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
} from '../types/index.js'

// ============================================================================
// MPC Types (mirrored from wallet-toolbox-mpc for interface compatibility)
// ============================================================================

/**
 * Progress info during Distributed Key Generation (DKG)
 */
export interface DKGProgressInfo {
  round: number
  totalRounds: number
  message: string
}

/**
 * MPC Key identifier
 */
export interface MPCKeyId {
  walletId: string
  keyIndex: number
  collectivePublicKey: string
}

/**
 * MPC Wallet interface - provided by external MPC implementation
 *
 * This mirrors the interface from @bsv/wallet-toolbox/out/src/mpc/MPCWallet
 * When the MPC modules become available, this type can be replaced with the import.
 */
export interface IMPCWallet {
  getPublicKey(args: { identityKey?: boolean; protocolID?: [0 | 1 | 2, string]; keyID?: string; counterparty?: string; forSelf?: boolean }): Promise<{ publicKey: string }>
  encrypt(args: { plaintext: number[]; protocolID: [0 | 1 | 2, string]; keyID: string; counterparty?: string }): Promise<{ ciphertext: number[] }>
  decrypt(args: { ciphertext: number[]; protocolID: [0 | 1 | 2, string]; keyID: string; counterparty?: string }): Promise<{ plaintext: number[] }>
  createSignature(args: { data: number[]; protocolID: [0 | 1 | 2, string]; keyID: string; counterparty?: string }): Promise<{ signature: number[] }>
  verifySignature(args: { data: number[]; signature: number[]; protocolID: [0 | 1 | 2, string]; keyID: string; counterparty?: string }): Promise<{ valid: boolean }>
  createHmac(args: { data: number[]; protocolID: [0 | 1 | 2, string]; keyID: string; counterparty?: string }): Promise<{ hmac: number[] }>
  verifyHmac(args: { data: number[]; hmac: number[]; protocolID: [0 | 1 | 2, string]; keyID: string; counterparty?: string }): Promise<{ valid: boolean }>
  createAction(args: Record<string, unknown>): Promise<{ txid?: string; tx?: number[] | Uint8Array }>
  acquireCertificate(args: Record<string, unknown>): Promise<Record<string, unknown>>
  listCertificates(args: Record<string, unknown>): Promise<{ certificates: Array<Record<string, unknown>> }>
  getHeight(args: Record<string, unknown>): Promise<{ height: number }>
  destroy(): Promise<void>
}

/**
 * Factory function type for creating MPC wallets
 */
export type MPCWalletFactory = (config: {
  userId: string
  walletId: string
  cosigners: Array<{ id: string; endpoint: string }>
  storage: StorageKnex
  authToken: string
  userPassword: string
  chain: Chain
  onProgress?: (info: DKGProgressInfo) => void
}) => Promise<IMPCWallet>

/**
 * Configuration for MPC Agent Wallet
 */
export interface MPCAgentWalletConfig {
  /** Unique wallet identifier */
  walletId: string
  /** URLs of cosigner servers (e.g., ['http://localhost:8081', 'http://localhost:8082']) */
  cosignerEndpoints: string[]
  /** Secret for encrypting share at rest (from env/secrets manager) */
  shareSecret: string
  /** Secret for JWT auth with cosigners */
  jwtSecret: string
  /** Network: 'mainnet' or 'testnet' (defaults to mainnet) */
  network?: 'mainnet' | 'testnet'
  /** SQLite database path (defaults to './mpc-wallet.sqlite') */
  storagePath?: string
  /** Optional progress callback for DKG */
  onDKGProgress?: (info: DKGProgressInfo) => void
  /**
   * Optional: Pre-configured MPC wallet instance
   *
   * If provided, this wallet will be used directly instead of creating a new one.
   * This allows injection of the actual MPC implementation from wallet-toolbox-mpc.
   */
  mpcWallet?: IMPCWallet
  /**
   * Optional: Factory function to create MPC wallets
   *
   * If provided, this factory will be used to create new wallets.
   * This allows injection of the MPC wallet creation logic from wallet-toolbox-mpc.
   */
  mpcWalletFactory?: MPCWalletFactory
  /** Optional: Presign pool for fast 1-round signing */
  presignPool?: { generate(keyId: string, count?: number): Promise<void>; availableCount(keyId: string): number; isGenerating(keyId?: string): boolean; isSupported(): Promise<boolean> }
  /** Optional: Signing coordinator for event-driven signing */
  signingCoordinator?: { setPresignPool(pool: any): void; getStatus(): any }
}

/**
 * MPC Agent Wallet - BRC-100 wallet with MPC threshold signatures
 *
 * Uses distributed key generation (DKG) and threshold signing to ensure
 * no single party ever has access to the complete private key.
 *
 * @example
 * ```typescript
 * // With injected MPC implementation (recommended)
 * import { MPCWallet } from 'wallet-toolbox-mpc';
 *
 * const mpcWallet = await MPCWallet.create({ ... });
 * const { wallet } = await createMPCAgentWallet({
 *   walletId: 'ai-agent-001',
 *   cosignerEndpoints: ['http://localhost:8081'],
 *   shareSecret: process.env.MPC_SHARE_SECRET!,
 *   jwtSecret: process.env.MPC_JWT_SECRET!,
 *   mpcWallet: mpcWallet  // Inject the MPC implementation
 * });
 *
 * // Then use like any BRC100Wallet
 * const sig = await wallet.createSignature({ ... });
 * ```
 */
export class MPCAgentWallet implements BRC100Wallet {
  private config: MPCAgentWalletConfig
  private chain: Chain
  private initialized = false

  // MPC components
  private mpcWallet: IMPCWallet | null = null
  private presignPool: MPCAgentWalletConfig['presignPool'] | null = null

  // Identity
  private identityPublicKey: string | null = null
  private collectivePublicKey: string | null = null

  // Signing lock to prevent concurrent MPC operations (would corrupt WASM state)
  private signingLock: Promise<void> = Promise.resolve()

  // MessageBox + PeerPay clients
  private messageBoxClient: MessageBoxClient | null = null
  private peerPayClient: PeerPayClient | null = null

  constructor(config: MPCAgentWalletConfig) {
    this.config = config
    this.chain = config.network === 'testnet' ? 'test' : 'main'
  }

  /**
   * Initialize the MPC wallet
   *
   * If an mpcWallet was provided in config, it will be used directly.
   * If an mpcWalletFactory was provided, it will be called to create a new wallet.
   * Otherwise, initialization will fail with a helpful error message.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return

    // Option 1: Use injected MPC wallet
    if (this.config.mpcWallet) {
      this.mpcWallet = this.config.mpcWallet

      // Get identity key from the injected wallet
      const publicKeyResult = await this.mpcWallet.getPublicKey({ identityKey: true })
      this.identityPublicKey = publicKeyResult.publicKey
      this.collectivePublicKey = publicKeyResult.publicKey

      // Store presign pool reference for status/warmup
      if (this.config.presignPool) this.presignPool = this.config.presignPool

      this.initialized = true
      return
    }

    // Option 2: Use factory to create wallet
    if (this.config.mpcWalletFactory) {
      const { knex } = await import('knex')
      const dbPath = this.config.storagePath ?? './mpc-wallet.sqlite'

      const knexInstance = knex({
        client: 'sqlite3',
        connection: { filename: dbPath },
        useNullAsDefault: true,
      })

      const storageKnex = new StorageKnex({
        chain: this.chain,
        knex: knexInstance,
        commissionSatoshis: 0,
        feeModel: { model: 'sat/kb', value: 100 },
      })

      // Generate auth token (simplified - real implementation would use JWT)
      const authToken = Buffer.from(JSON.stringify({
        clientId: `wallet-${this.config.walletId}`,
        partyId: '1',
        userId: this.config.walletId,
        exp: Math.floor(Date.now() / 1000) + 3600,
      })).toString('base64')

      this.mpcWallet = await this.config.mpcWalletFactory({
        userId: this.config.walletId,
        walletId: this.config.walletId,
        cosigners: this.config.cosignerEndpoints.map((endpoint, i) => ({
          id: `cosigner${i + 1}`,
          endpoint,
        })),
        storage: storageKnex,
        authToken,
        userPassword: this.config.shareSecret,
        chain: this.chain,
        onProgress: this.config.onDKGProgress,
      })

      // Get identity key from the created wallet
      const publicKeyResult = await this.mpcWallet.getPublicKey({ identityKey: true })
      this.identityPublicKey = publicKeyResult.publicKey
      this.collectivePublicKey = publicKeyResult.publicKey

      this.initialized = true
      return
    }

    // Option 3: No MPC implementation available
    throw new Error(
      'MPC implementation not available. Please provide either:\n' +
      '  1. mpcWallet: A pre-configured MPC wallet instance\n' +
      '  2. mpcWalletFactory: A factory function to create MPC wallets\n' +
      '\n' +
      'The MPC modules are external to this package. Install wallet-toolbox-mpc:\n' +
      '  npm install @bsv/wallet-toolbox-mpc\n' +
      '\n' +
      'Or copy from MPC-DEV/wallet-toolbox-mpc into your project.\n' +
      '\n' +
      'Example with injected wallet:\n' +
      '  import { MPCWallet } from "@bsv/wallet-toolbox-mpc";\n' +
      '  const mpcWallet = await MPCWallet.create({ ... });\n' +
      '  const wallet = new MPCAgentWallet({ ..., mpcWallet });'
    )
  }

  /**
   * Serialize signing operations to prevent concurrent MPC calls
   *
   * MPC protocol requires exclusive access to key shares during signing.
   * Concurrent signing sessions corrupt each other's WASM state.
   */
  private async withSigningLock<T>(operation: () => Promise<T>): Promise<T> {
    const currentLock = this.signingLock
    let releaseLock: () => void

    this.signingLock = new Promise<void>((resolve) => {
      releaseLock = resolve
    })

    try {
      await currentLock
      return await operation()
    } finally {
      releaseLock!()
    }
  }

  /**
   * Ensure the wallet is initialized before operations
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize()
    }
    if (!this.mpcWallet) {
      throw new Error('MPC wallet not initialized')
    }
  }

  /**
   * Get the underlying MPC wallet instance
   *
   * For compatibility with messaging and other services that expect
   * access to the underlying wallet implementation.
   */
  getUnderlyingWallet(): IMPCWallet | null {
    return this.mpcWallet
  }

  /**
   * Get wallet balance and UTXOs
   * Delegates to the underlying wallet-toolbox wallet if available
   */
  async getBalanceAndUtxos(): Promise<{ total: number; utxos: Array<{ txid: string; vout: number; satoshis: number }> }> {
    await this.ensureInitialized()
    const wallet = this.mpcWallet as any

    // Use listOutputs from the underlying SDK wallet (most reliable)
    if (typeof wallet?.listOutputs === 'function') {
      const result = await wallet.listOutputs({ basket: 'default' })
      const utxos = (result.outputs || [])
        .filter((o: any) => o.spendable)
        .map((o: any) => {
          const [txid, voutStr] = (o.outpoint || '').split('.')
          return { txid, vout: parseInt(voutStr, 10), satoshis: o.satoshis }
        })
      const total = utxos.reduce((sum: number, u: any) => sum + u.satoshis, 0)
      return { total, utxos }
    }

    // Legacy fallbacks
    if (typeof wallet?.balanceAndUtxos === 'function') {
      return wallet.balanceAndUtxos()
    }
    if (typeof wallet?.balance === 'function') {
      const total = await wallet.balance()
      return { total, utxos: [] }
    }
    // Fallback: wallet doesn't expose balance directly
    return { total: 0, utxos: [] }
  }

  // ============================================================================
  // BRC-100 Interface Implementation
  // ============================================================================

  async getPublicKey(args: GetPublicKeyArgs): Promise<GetPublicKeyResult> {
    await this.ensureInitialized()

    if (args.identityKey) {
      return { publicKey: this.identityPublicKey! }
    }

    if (args.protocolID && args.keyID) {
      const result = await this.mpcWallet!.getPublicKey({
        identityKey: args.identityKey ? true : undefined,
        protocolID: args.protocolID as [0 | 1 | 2, string],
        keyID: args.keyID,
        counterparty: args.counterparty,
        forSelf: args.forSelf,
      })
      return { publicKey: result.publicKey }
    }

    return { publicKey: this.identityPublicKey! }
  }

  async encrypt(args: EncryptArgs): Promise<EncryptResult> {
    await this.ensureInitialized()
    const plaintext = args.plaintext instanceof Uint8Array ? Array.from(args.plaintext) : args.plaintext
    const result = await this.mpcWallet!.encrypt({
      plaintext,
      protocolID: args.protocolID as [0 | 1 | 2, string],
      keyID: args.keyID,
      counterparty: args.counterparty,
    })
    return { ciphertext: result.ciphertext }
  }

  async decrypt(args: DecryptArgs): Promise<DecryptResult> {
    await this.ensureInitialized()
    const ciphertext = args.ciphertext instanceof Uint8Array ? Array.from(args.ciphertext) : args.ciphertext
    const result = await this.mpcWallet!.decrypt({
      ciphertext,
      protocolID: args.protocolID as [0 | 1 | 2, string],
      keyID: args.keyID,
      counterparty: args.counterparty,
    })
    return { plaintext: result.plaintext }
  }

  async createSignature(args: CreateSignatureArgs): Promise<CreateSignatureResult> {
    await this.ensureInitialized()

    // CRITICAL: Wrap in signing lock to prevent concurrent MPC operations
    return this.withSigningLock(async () => {
      const data = args.data instanceof Uint8Array ? Array.from(args.data) : args.data
      const result = await this.mpcWallet!.createSignature({
        data,
        protocolID: args.protocolID as [0 | 1 | 2, string],
        keyID: args.keyID,
        counterparty: args.counterparty,
      })
      return { signature: result.signature }
    })
  }

  async verifySignature(args: VerifySignatureArgs): Promise<VerifySignatureResult> {
    await this.ensureInitialized()
    // No lock needed - verification is local, doesn't modify MPC state
    const data = args.data instanceof Uint8Array ? Array.from(args.data) : args.data
    const signature = args.signature instanceof Uint8Array ? Array.from(args.signature) : args.signature
    const result = await this.mpcWallet!.verifySignature({
      data,
      signature,
      protocolID: args.protocolID as [0 | 1 | 2, string],
      keyID: args.keyID,
      counterparty: args.counterparty,
    })
    return { valid: result.valid }
  }

  async createHmac(args: CreateHmacArgs): Promise<CreateHmacResult> {
    await this.ensureInitialized()
    const data = args.data instanceof Uint8Array ? Array.from(args.data) : args.data
    const result = await this.mpcWallet!.createHmac({
      data,
      protocolID: args.protocolID as [0 | 1 | 2, string],
      keyID: args.keyID,
      counterparty: args.counterparty,
    })
    return { hmac: result.hmac }
  }

  async verifyHmac(args: VerifyHmacArgs): Promise<VerifyHmacResult> {
    await this.ensureInitialized()
    const data = args.data instanceof Uint8Array ? Array.from(args.data) : args.data
    const hmac = args.hmac instanceof Uint8Array ? Array.from(args.hmac) : args.hmac
    const result = await this.mpcWallet!.verifyHmac({
      data,
      hmac,
      protocolID: args.protocolID as [0 | 1 | 2, string],
      keyID: args.keyID,
      counterparty: args.counterparty,
    })
    return { valid: result.valid }
  }

  async createAction(args: CreateActionArgs): Promise<CreateActionResult> {
    await this.ensureInitialized()

    // CRITICAL: Wrap in signing lock - createAction involves MPC signing
    return this.withSigningLock(async () => {
      const result = await this.mpcWallet!.createAction({
        description: args.description,
        outputs: args.outputs?.map((o) => ({
          lockingScript: o.script,
          satoshis: o.satoshis,
          outputDescription: o.description ?? '',
          basket: o.basket,
          tags: o.tags,
        })),
        inputs: args.inputs?.map((i) => ({
          outpoint: i.outpoint,
          unlockingScript: i.unlockingScript,
          inputDescription: i.inputDescription ?? '',
        })),
        labels: args.labels,
        lockTime: args.lockTime,
        version: args.version,
      })

      let rawTx: number[] | undefined
      if (result.tx) {
        rawTx = Array.isArray(result.tx) ? result.tx : Array.from(result.tx)
      }
      return { txid: result.txid ?? '', rawTx }
    })
  }

  /**
   * List wallet outputs, optionally filtered by basket, tags, etc.
   * Proxies directly to the underlying wallet-toolbox wallet's listOutputs.
   */
  async listOutputs(args: any): Promise<any> {
    await this.ensureInitialized()
    return this.withSigningLock(async () => {
      return (this.mpcWallet as any).listOutputs(args)
    })
  }

  /**
   * Internalize an incoming transaction (e.g. accept a PeerPay payment).
   * Proxies directly to the underlying MPC wallet's internalizeAction.
   */
  async internalizeAction(args: any, originator?: string): Promise<any> {
    await this.ensureInitialized()
    return this.withSigningLock(async () => {
      return (this.mpcWallet as any).internalizeAction(args, originator)
    })
  }

  async acquireCertificate(args: AcquireCertificateArgs): Promise<AcquireCertificateResult> {
    await this.ensureInitialized()
    const result = await this.mpcWallet!.acquireCertificate({
      type: args.type,
      certifier: args.certifier,
      acquisitionProtocol: args.acquisitionProtocol,
      fields: args.fields ?? {},
    })
    return {
      certificate: {
        type: result.type as string,
        serialNumber: result.serialNumber as string,
        subject: result.subject as string,
        certifier: result.certifier as string,
        revocationOutpoint: result.revocationOutpoint as string,
        fields: result.fields as Record<string, string>,
        signature: (result.signature as string) ?? '',
      },
    }
  }

  async listCertificates(args: ListCertificatesArgs): Promise<ListCertificatesResult> {
    await this.ensureInitialized()
    const result = await this.mpcWallet!.listCertificates({
      certifiers: args.certifiers ?? [],
      types: args.types ?? [],
    })
    return {
      certificates: result.certificates.map((c) => ({
        type: c.type as string,
        serialNumber: c.serialNumber as string,
        subject: c.subject as string,
        certifier: c.certifier as string,
        revocationOutpoint: c.revocationOutpoint as string,
        fields: c.fields as Record<string, string>,
        signature: (c.signature as string) ?? '',
      })),
    }
  }

  async getNetwork(): Promise<'mainnet' | 'testnet'> {
    return this.chain === 'main' ? 'mainnet' : 'testnet'
  }

  async getHeight(): Promise<number> {
    await this.ensureInitialized()
    return (await this.mpcWallet!.getHeight({})).height
  }

  async isAuthenticated(): Promise<boolean> {
    return this.initialized
  }

  asWalletInterface(): WalletInterface {
    if (!this.mpcWallet) throw new Error('Wallet not initialized')
    return this.createLockedWalletProxy() as unknown as WalletInterface
  }

  // ============================================================================
  // Additional MPC-Specific Methods
  // ============================================================================

  /**
   * Get the MPC collective public key
   *
   * This is the public key derived from all parties' shares combined.
   * It represents the "wallet" identity.
   */
  getCollectivePublicKey(): string {
    if (!this.collectivePublicKey) {
      throw new Error('Wallet not initialized')
    }
    return this.collectivePublicKey
  }

  /**
   * Check if this wallet is using MPC or if it's uninitialized
   */
  isInitialized(): boolean {
    return this.initialized
  }

  /**
   * Get the underlying MPC wallet for advanced operations
   *
   * Returns null if not initialized.
   */
  getUnderlyingMPCWallet(): IMPCWallet | null {
    return this.mpcWallet
  }

  // ============================================================================
  // Presign Pool
  // ============================================================================

  /**
   * Get presign pool status for health checks and identity reporting.
   * Returns null if presign pool is not configured.
   */
  getPresignPoolStatus(): { available: number; generating: boolean; supported: boolean } | null {
    if (!this.presignPool) return null
    const keyId = `${this.config.walletId}:0`
    return {
      available: this.presignPool.availableCount(keyId),
      generating: this.presignPool.isGenerating(keyId),
      supported: true,
    }
  }

  /**
   * Generate presignatures if the pool is empty.
   * Non-blocking warmup for startup.
   */
  async warmupPresignPool(): Promise<void> {
    if (!this.presignPool) return
    const keyId = `${this.config.walletId}:0`
    if (this.presignPool.availableCount(keyId) === 0) {
      await this.presignPool.generate(keyId)
    }
  }

  // ============================================================================
  // MessageBox + PeerPay Integration
  // ============================================================================

  /**
   * Initialize MessageBox and PeerPay clients.
   * All MessageBox operations are wrapped in the signing lock to prevent
   * concurrent MPC operations from corrupting WASM state.
   */
  async initializeMessageBox(host: string = 'https://messagebox.babbage.systems'): Promise<void> {
    await this.ensureInitialized()

    // asWalletInterface() returns a signing-lock proxy so that
    // MessageBoxClient/PeerPayClient route ALL signing operations through
    // the lock, preventing concurrent WASM state corruption.
    this.messageBoxClient = new MessageBoxClient({
      walletClient: this.asWalletInterface(),
      host,
      enableLogging: false,
      networkPreset: 'mainnet',
    })

    await this.withSigningLock(async () => {
      await this.messageBoxClient!.init()
    })

    this.peerPayClient = new PeerPayClient({
      walletClient: this.asWalletInterface(),
      messageBoxHost: host,
      enableLogging: false,
    })
  }

  /**
   * Create a proxy around the raw MPC wallet that serializes all
   * mutating operations through the signing lock.
   * Read-only operations (getPublicKey, verifySignature, getNetwork, etc.)
   * pass through directly.
   */
  private createLockedWalletProxy(): IMPCWallet {
    const raw = this.mpcWallet!
    const lock = <T>(fn: () => Promise<T>) => this.withSigningLock(fn)

    return new Proxy(raw, {
      get: (target, prop, receiver) => {
        // These methods mutate MPC WASM state and MUST be serialized
        const lockedMethods = new Set([
          'createSignature', 'createHmac',
          'createAction', 'internalizeAction',
          'encrypt', 'decrypt',
        ])
        if (typeof prop === 'string' && lockedMethods.has(prop)) {
          return (...args: any[]) => lock(() => (target as any)[prop](...args))
        }
        return Reflect.get(target, prop, receiver)
      }
    })
  }

  getMessageBoxClient(): MessageBoxClient | null {
    return this.messageBoxClient
  }

  getPeerPayClient(): PeerPayClient | null {
    return this.peerPayClient
  }

  async sendMessage(args: { recipient: string; messageBox: string; body: string }): Promise<any> {
    if (!this.messageBoxClient) throw new Error('MessageBox not initialized')
    // No outer lock — the lockedWallet proxy already serializes individual
    // signing operations (createSignature, createHmac, etc.) inside authFetch.
    // Wrapping the whole call in withSigningLock would deadlock because
    // authFetch tries to acquire the same non-reentrant lock for signing.
    return this.messageBoxClient.sendMessage(args)
  }

  async listMessages(args: { messageBox: string }): Promise<any[]> {
    if (!this.messageBoxClient) throw new Error('MessageBox not initialized')
    return this.messageBoxClient.listMessages(args)
  }

  async acknowledgeMessages(args: { messageIds: string[] }): Promise<void> {
    if (!this.messageBoxClient) throw new Error('MessageBox not initialized')
    await this.messageBoxClient.acknowledgeMessage(args)
  }

  async sendPayment(args: { recipient: string; amount: number }): Promise<void> {
    if (!this.peerPayClient) throw new Error('PeerPay not initialized')
    await this.peerPayClient.sendPayment(args)
  }

  /**
   * Clean up resources
   */
  async destroy(): Promise<void> {
    if (this.mpcWallet) {
      await this.mpcWallet.destroy()
      this.mpcWallet = null
    }
    this.initialized = false
  }
}

/**
 * Create an MPC-secured agent wallet
 *
 * @example
 * ```typescript
 * // With injected MPC implementation (recommended)
 * import { MPCWallet } from '@bsv/wallet-toolbox-mpc';
 *
 * const mpcWallet = await MPCWallet.create({
 *   userId: 'ai-agent-001',
 *   walletId: 'ai-agent-001',
 *   cosigners: [
 *     { id: 'cosigner1', endpoint: 'http://localhost:8081' },
 *     { id: 'cosigner2', endpoint: 'http://localhost:8082' }
 *   ],
 *   // ... other MPC config
 * });
 *
 * const { wallet } = await createMPCAgentWallet({
 *   walletId: 'ai-agent-001',
 *   cosignerEndpoints: ['http://localhost:8081', 'http://localhost:8082'],
 *   shareSecret: process.env.MPC_SHARE_SECRET!,
 *   jwtSecret: process.env.MPC_JWT_SECRET!,
 *   network: 'mainnet',
 *   mpcWallet: mpcWallet  // Inject the MPC implementation
 * });
 *
 * // Use like any BRC100Wallet
 * const sig = await wallet.createSignature({
 *   data: [1, 2, 3],
 *   protocolID: [0, 'signing'],
 *   keyID: 'default'
 * });
 * ```
 */
export async function createMPCAgentWallet(
  config: MPCAgentWalletConfig
): Promise<{ wallet: MPCAgentWallet }> {
  const wallet = new MPCAgentWallet(config)
  await wallet.initialize()
  return { wallet }
}
