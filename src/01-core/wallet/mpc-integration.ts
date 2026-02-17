/**
 * MPC Production Integration
 *
 * Factory function and configuration utilities for production MPC wallet usage.
 * Handles both DKG (new wallet creation) and restore (existing wallet) paths.
 *
 * @see MPC-DEV/wallet-toolbox-mpc for the MPC implementation
 * @see .planning/phases/3.1-mpc-production-integration/3.1-RESEARCH.md for architecture
 */

import jwt from 'jsonwebtoken'
import knexLib from 'knex'
import type { Knex } from 'knex'

const createKnex = knexLib

// Import MPC modules from wallet-toolbox-mpc
import {
  MPCWallet,
  MPCClient,
  MPCPersistence,
  MPCKeyDeriver,
} from '@bsv/wallet-toolbox-mpc/out/src/mpc/index.js'
import type {
  DKGProgressInfo,
  MPCConfig,
  MPCParty,
  MPCKeyId,
} from '@bsv/wallet-toolbox-mpc/out/src/mpc/types.js'
import type { Chain } from '@bsv/wallet-toolbox-mpc/out/src/sdk/types.js'
import { decryptShare } from '@bsv/wallet-toolbox-mpc/out/src/mpc/utils/shareEncryption.js'
import { KnexMigrations } from '@bsv/wallet-toolbox-mpc/out/src/storage/schema/KnexMigrations.js'
import { WalletStorageManager } from '@bsv/wallet-toolbox-mpc/out/src/storage/WalletStorageManager.js'
import { StorageKnex } from '@bsv/wallet-toolbox-mpc/out/src/storage/StorageKnex.js'
import { MPCAgentWallet } from './mpc-agent-wallet.js'

// Re-export for consumer convenience
export type { DKGProgressInfo }

/**
 * Configuration for production MPC wallet
 */
export interface ProductionMPCConfig {
  /** Unique wallet identifier (used for share storage and cosigner coordination) */
  walletId: string
  /** URLs of cosigner servers (e.g., ['http://localhost:8081', 'http://localhost:8082']) */
  cosignerEndpoints: string[]
  /** Secret for encrypting share at rest (from env/secrets manager) */
  shareSecret: string
  /** Secret for JWT auth with cosigners */
  jwtSecret: string
  /** Network: 'mainnet' or 'testnet' (defaults to mainnet) */
  network?: 'mainnet' | 'testnet'
  /** SQLite database path (defaults to './data/mpc-wallet.sqlite') */
  storagePath?: string
  /** Optional progress callback for DKG */
  onProgress?: (info: DKGProgressInfo) => void
  /** Optional error callback */
  onError?: (error: Error) => void
}

/**
 * Result of creating a production MPC wallet
 */
export interface ProductionMPCWalletResult {
  /** The initialized MPCWallet wrapped in MPCAgentWallet */
  wallet: any // MPCAgentWallet (using any to avoid circular dependency)
  /** The raw MPCWallet instance */
  rawWallet: MPCWallet
  /** True if a new wallet was created via DKG, false if restored from existing share */
  isNewWallet: boolean
  /** The collective public key (identity key) of the wallet */
  collectivePublicKey: string
}

/**
 * Load MPC configuration from environment variables
 *
 * Required environment variables:
 * - MPC_COSIGNER_ENDPOINTS: Comma-separated list of cosigner URLs
 * - MPC_SHARE_SECRET: Password for share encryption
 * - MPC_JWT_SECRET: Secret for cosigner authentication
 *
 * Optional environment variables:
 * - MPC_WALLET_ID: Unique wallet identifier (default: 'agent-wallet')
 * - MPC_NETWORK: 'mainnet' or 'testnet' (default: 'mainnet')
 * - MPC_STORAGE_PATH: SQLite database path (default: './data/mpc-wallet.sqlite')
 *
 * @throws Error if required environment variables are not set
 */
export function loadMPCConfigFromEnv(): ProductionMPCConfig {
  const requireEnv = (key: string): string => {
    const value = process.env[key]
    if (!value) {
      throw new Error(`Required environment variable ${key} is not set`)
    }
    return value
  }

  const endpointsRaw = process.env.MPC_COSIGNER_ENDPOINTS
  if (!endpointsRaw || endpointsRaw.trim() === '') {
    throw new Error(
      'MPC_COSIGNER_ENDPOINTS must contain at least one endpoint (comma-separated URLs)'
    )
  }
  const cosignerEndpoints = endpointsRaw.split(',').map((s) => s.trim()).filter((s) => s.length > 0)
  if (cosignerEndpoints.length === 0) {
    throw new Error(
      'MPC_COSIGNER_ENDPOINTS must contain at least one valid endpoint URL'
    )
  }

  const network = process.env.MPC_NETWORK === 'testnet' ? 'testnet' : 'mainnet'

  return {
    walletId: process.env.MPC_WALLET_ID ?? 'agent-wallet',
    cosignerEndpoints,
    shareSecret: requireEnv('MPC_SHARE_SECRET'),
    jwtSecret: requireEnv('MPC_JWT_SECRET'),
    network,
    storagePath: process.env.MPC_STORAGE_PATH ?? './data/mpc-wallet.sqlite',
  }
}

/**
 * Generate a JWT token for cosigner authentication
 *
 * @param jwtSecret - The shared JWT secret
 * @param walletId - The wallet identifier
 * @param partyId - The party ID (default: '1' for user)
 * @returns Base64-encoded JWT-like token
 */
function generateAuthToken(jwtSecret: string, walletId: string, partyId: string = '1'): string {
  // Create properly signed JWT for cosigner authentication
  const payload = {
    clientId: `wallet-${walletId}`,
    partyId,
    userId: walletId,
  }
  // Sign with jsonwebtoken library (expires in 1 hour)
  return jwt.sign(payload, jwtSecret, { expiresIn: '1h' })
}

/**
 * Create a production MPC wallet
 *
 * This function handles both wallet creation (DKG) and restoration paths:
 * - If a share exists in storage, restores the wallet from the encrypted share
 * - If no share exists, runs DKG protocol with cosigners to create a new wallet
 *
 * CRITICAL: Always checks for existing share BEFORE running DKG.
 * Running DKG when a share already exists will create a mismatched wallet
 * that cannot sign (cosigners will have different shares).
 *
 * @param config - Production MPC configuration
 * @returns The initialized wallet and metadata
 * @throws Error if configuration is invalid, DKG fails, or share decryption fails
 *
 * @example
 * ```typescript
 * // Load config from environment
 * const config = loadMPCConfigFromEnv()
 *
 * // Create or restore wallet
 * const { wallet, isNewWallet, collectivePublicKey } = await createProductionMPCWallet(config)
 *
 * if (isNewWallet) {
 *   console.log('New wallet created via DKG')
 * } else {
 *   console.log('Existing wallet restored')
 * }
 *
 * // Use wallet for signing
 * const sig = await wallet.createSignature({ ... })
 * ```
 */
export async function createProductionMPCWallet(
  config: ProductionMPCConfig
): Promise<ProductionMPCWalletResult> {
  const chain: Chain = config.network === 'testnet' ? 'test' : 'main'
  const storagePath = config.storagePath ?? './data/mpc-wallet.sqlite'
  const keyIndex = 0 // Always use key index 0 for primary key

  // ============================================================================
  // 1. Initialize Knex and run migrations
  // ============================================================================

  const knexInstance = createKnex({
    client: 'sqlite3',
    connection: { filename: storagePath },
    useNullAsDefault: true,
  })

  // Run migrations to ensure MPC tables exist
  const migrationSource = new KnexMigrations(
    chain,
    'mpc-production',
    config.walletId,
    1024
  )
  await knexInstance.migrate.latest({ migrationSource })

  // ============================================================================
  // 2. Check for existing share (determines DKG vs restore path)
  // ============================================================================

  const persistence = new MPCPersistence(knexInstance)
  const existingShare = await persistence.loadShare(config.walletId, keyIndex)

  // ============================================================================
  // 3. Either restore existing wallet or create new via DKG
  // ============================================================================

  if (existingShare) {
    // RESTORE PATH: Existing share found
    return await restoreExistingWallet(config, existingShare, persistence, knexInstance, chain)
  } else {
    // DKG PATH: No share found, create new wallet
    return await createNewWallet(config, persistence, knexInstance, chain)
  }
}

/**
 * Restore an existing wallet from encrypted share
 */
async function restoreExistingWallet(
  config: ProductionMPCConfig,
  storedShare: {
    walletId: string
    keyIndex: number
    encryptedShare: string
    collectivePublicKey: string
    threshold: number
    totalParties: number
    mpcMetadata?: object
    auxiliaryKeys?: object
  },
  persistence: MPCPersistence,
  knexInstance: Knex,
  chain: Chain
): Promise<ProductionMPCWalletResult> {
  const keyIndex = storedShare.keyIndex

  // ============================================================================
  // 1. Verify password (implicit via decryptShare below)
  // ============================================================================

  // ============================================================================
  // 2. Decrypt share
  // ============================================================================

  let shareBytes: Buffer
  try {
    shareBytes = decryptShare(storedShare.encryptedShare, config.shareSecret)
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error'
    throw new Error(`Failed to decrypt share: ${msg}. Check MPC_SHARE_SECRET.`)
  }

  // ============================================================================
  // 3. Initialize MPC Client with decrypted share
  // ============================================================================

  const parties: MPCParty[] = [
    { partyId: '1', type: 'user' },
    ...config.cosignerEndpoints.map((endpoint, i) => ({
      partyId: (i + 2).toString(),
      type: 'cosigner' as const,
      endpoint,
    })),
  ]

  const mpcConfig: MPCConfig = {
    partyId: '1',
    totalParties: storedShare.totalParties,
    threshold: storedShare.threshold,
    parties,
    jwtToken: generateAuthToken(config.jwtSecret, config.walletId),
  }

  const mpcClient = new MPCClient(mpcConfig)
  await mpcClient.initialize(shareBytes)

  // Load share, metadata, and auxiliary keys into WASM
  await mpcClient.loadShareIntoWASM(config.walletId, keyIndex)

  if (storedShare.mpcMetadata) {
    await mpcClient.loadMetadataIntoWASM(config.walletId, keyIndex, storedShare.mpcMetadata)
  }

  // CRITICAL: Load auxiliary keys (Paillier/Ring-Pedersen secrets) for signing
  // Without these, signing will fail with cryptic verification errors
  if (storedShare.auxiliaryKeys && Object.keys(storedShare.auxiliaryKeys).length > 0) {
    await mpcClient.loadAuxiliaryKeysIntoWASM(config.walletId, keyIndex, storedShare.auxiliaryKeys)
  }

  // ============================================================================
  // 4. Initialize derivation encryption if salts exist
  // ============================================================================

  // Note: DerivationEncryption for cached key derivations is not yet available
  // in this version of wallet-toolbox-mpc. Derivations are stored unencrypted
  // in the local SQLite database (which should be access-controlled at OS level).

  // ============================================================================
  // 5. Create key deriver and storage
  // ============================================================================

  const keyId: MPCKeyId = {
    walletId: config.walletId,
    keyIndex,
    collectivePublicKey: storedShare.collectivePublicKey,
  }

  const keyDeriver = new MPCKeyDeriver(mpcClient, keyId, persistence)

  // Create storage manager
  const storageKnex = new StorageKnex({
    chain,
    knex: knexInstance,
    commissionSatoshis: 0,
    feeModel: { model: 'sat/kb', value: 100 },
  })

  await storageKnex.makeAvailable()

  // Wrap in WalletStorageManager with collective public key as identity
  const storageManager = new WalletStorageManager(storedShare.collectivePublicKey, storageKnex)
  await storageManager.makeAvailable()

  // ============================================================================
  // 6. Create and return MPCWallet
  // ============================================================================

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawWallet = new MPCWallet({
    chain,
    keyDeriver,
    storage: storageManager,
    mpcClient,
    persistence,
  })

  // Wrap in MPCAgentWallet for compatibility
  const agentWallet = new MPCAgentWallet({
    walletId: config.walletId,
    cosignerEndpoints: config.cosignerEndpoints,
    shareSecret: config.shareSecret,
    jwtSecret: config.jwtSecret,
    network: config.network,
    storagePath: config.storagePath,
    mpcWallet: rawWallet as any,
  })
  await agentWallet.initialize()

  return {
    wallet: agentWallet,
    rawWallet,
    isNewWallet: false,
    collectivePublicKey: storedShare.collectivePublicKey,
  }
}

/**
 * Create a new wallet via Distributed Key Generation (DKG)
 */
async function createNewWallet(
  config: ProductionMPCConfig,
  _persistence: MPCPersistence,
  knexInstance: Knex,
  chain: Chain
): Promise<ProductionMPCWalletResult> {
  // ============================================================================
  // 1. Build MPC configuration
  // ============================================================================

  const parties: MPCParty[] = [
    { partyId: '1', type: 'user' },
    ...config.cosignerEndpoints.map((endpoint, i) => ({
      partyId: (i + 2).toString(),
      type: 'cosigner' as const,
      endpoint,
    })),
  ]

  const totalParties = parties.length
  const threshold = totalParties // MPC-CMP requires threshold == totalParties

  const mpcConfig: MPCConfig = {
    partyId: '1',
    totalParties,
    threshold,
    parties,
    jwtToken: generateAuthToken(config.jwtSecret, config.walletId),
  }

  const mpcClient = new MPCClient(mpcConfig)

  // ============================================================================
  // 2. Create storage manager with WalletStorageManager
  // ============================================================================

  const storageKnex = new StorageKnex({
    chain,
    knex: knexInstance,
    commissionSatoshis: 0,
    feeModel: { model: 'sat/kb', value: 100 },
  })

  await storageKnex.makeAvailable()

  // Create WalletStorageManager wrapping StorageKnex
  // Use walletId as temporary identityKey (will be updated after DKG)
  const storageManager = new WalletStorageManager(config.walletId, storageKnex)
  await storageManager.makeAvailable()

  // ============================================================================
  // 3. Create wallet via DKG
  // ============================================================================

  // MPCWallet.create() handles the full DKG protocol
  const rawWallet = await MPCWallet.create({
    userId: 1, // User ID for persistence
    walletId: config.walletId,
    cosigners: config.cosignerEndpoints.map((endpoint, i) => ({
      id: `cosigner${i + 1}`,
      endpoint,
    })),
    storage: storageManager,
    mpcClient,
    authToken: generateAuthToken(config.jwtSecret, config.walletId),
    userPassword: config.shareSecret,
    chain,
    onProgress: config.onProgress,
    onError: config.onError,
  })

  // Get collective public key from the created wallet
  const collectivePublicKey = rawWallet.identityKey

  // Update storage manager with actual collective public key
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(storageManager as any)._authId = {
    identityKey: collectivePublicKey,
  }

  // Wrap in MPCAgentWallet for compatibility
  const agentWallet = new MPCAgentWallet({
    walletId: config.walletId,
    cosignerEndpoints: config.cosignerEndpoints,
    shareSecret: config.shareSecret,
    jwtSecret: config.jwtSecret,
    network: config.network,
    storagePath: config.storagePath,
    mpcWallet: rawWallet as any,
  })
  await agentWallet.initialize()

  return {
    wallet: agentWallet,
    rawWallet,
    isNewWallet: true,
    collectivePublicKey,
  }
}
