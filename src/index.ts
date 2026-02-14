/**
 * AGIdentity
 *
 * A lightweight wrapper around OpenClaw that adds:
 * - BRC-100 wallet identity for AI agents
 * - Encrypted Shad semantic memory
 * - UHRP blockchain-timestamped storage
 * - Per-interaction encryption (Edwin-style security)
 *
 * @module agidentity
 */

// Core types
export * from './types/index.js';

// Wallet
export { AgentWallet, createAgentWallet } from './wallet/agent-wallet.js';

// UHRP Storage
export { AGIdentityStorageManager } from './uhrp/storage-manager.js';
export type { StorageManagerConfig, UploadOptions } from './uhrp/storage-manager.js';

// Shad Integration
export { EncryptedShadVault } from './shad/encrypted-vault.js';
export type { EncryptedVaultConfig } from './shad/encrypted-vault.js';
export { AGIdentityShadBridge, createShadBridge } from './shad/shad-integration.js';
export type { ShadBridgeConfig } from './shad/shad-integration.js';

// Encryption
export {
  PerInteractionEncryption,
  SessionEncryption,
} from './encryption/per-interaction.js';
export type {
  InteractionContext,
  EncryptedMessage,
  DecryptedMessage,
} from './encryption/per-interaction.js';

// Plugin
export { createAGIdentityPlugin, default as createAGIdentityPluginDefault } from './plugin/agidentity-plugin.js';

// Team/Group Encryption
export { TeamVault } from './team/team-vault.js';
export type { TeamVaultConfig } from './team/team-vault.js';

// ============================================================================
// Convenience Factory Functions
// ============================================================================

import type { AGIdentityConfig, BRC100Wallet } from './types/index.js';
import { createAgentWallet } from './wallet/agent-wallet.js';
import { AGIdentityStorageManager } from './uhrp/storage-manager.js';
import { EncryptedShadVault } from './shad/encrypted-vault.js';
import { createShadBridge, AGIdentityShadBridge } from './shad/shad-integration.js';
import { createAGIdentityPlugin } from './plugin/agidentity-plugin.js';
import { TeamVault } from './team/team-vault.js';

/**
 * AGIdentity instance with all components initialized
 */
export interface AGIdentityInstance {
  wallet: BRC100Wallet;
  storage: AGIdentityStorageManager;
  vault: EncryptedShadVault;
  shad: AGIdentityShadBridge;
  team: TeamVault;
  config: AGIdentityConfig;
}

/**
 * Create a fully initialized AGIdentity instance
 *
 * @example
 * ```typescript
 * import { createAGIdentity } from 'agidentity';
 *
 * const agidentity = await createAGIdentity({
 *   storageUrl: 'https://uhrp.example.com',
 *   network: 'mainnet',
 *   agentWallet: {
 *     type: 'privateKey',
 *     privateKeyWif: 'your-wif-here'
 *   }
 * });
 *
 * // Use the components
 * const balance = await agidentity.wallet.getPublicKey({ identityKey: true });
 * const docs = await agidentity.vault.listDocuments();
 * ```
 */
export async function createAGIdentity(
  config: AGIdentityConfig
): Promise<AGIdentityInstance> {
  // Initialize wallet
  const wallet = await createAgentWallet(config.agentWallet);

  // Initialize storage
  const storage = new AGIdentityStorageManager({
    storageUrl: config.storageUrl,
    wallet,
    network: config.network
  });

  // Initialize vault
  const vault = new EncryptedShadVault({
    storageManager: storage,
    wallet
  });

  // Initialize Shad bridge
  const shad = createShadBridge(vault, wallet, config.shad);

  // Initialize team vault for group encryption
  const team = new TeamVault({ wallet });

  return {
    wallet,
    storage,
    vault,
    shad,
    team,
    config
  };
}

/**
 * Create AGIdentity with OpenClaw integration
 *
 * @example
 * ```typescript
 * import { createAGIdentityWithOpenClaw } from 'agidentity';
 * import { createGateway } from 'openclaw';
 *
 * const { plugin, instance } = await createAGIdentityWithOpenClaw({
 *   storageUrl: 'https://uhrp.example.com',
 *   agentWallet: { type: 'privateKey', privateKeyWif: '...' }
 * });
 *
 * // Use with OpenClaw
 * const gateway = createGateway({
 *   plugins: [plugin]
 * });
 * ```
 */
export async function createAGIdentityWithOpenClaw(
  config: AGIdentityConfig
): Promise<{
  plugin: ReturnType<typeof createAGIdentityPlugin>;
  instance: AGIdentityInstance;
}> {
  const instance = await createAGIdentity(config);
  const plugin = createAGIdentityPlugin(config);

  return { plugin, instance };
}

// Default export
export default createAGIdentity;
