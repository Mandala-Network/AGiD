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
export * from './07-shared/types/index.js';

// Wallet
export { AgentWallet, createAgentWallet } from './01-core/wallet/agent-wallet.js';
export type { AgentWalletConfig, WalletBalanceInfo } from './01-core/wallet/agent-wallet.js';
export {
  MPCAgentWallet,
  createMPCAgentWallet,
} from './01-core/wallet/mpc-agent-wallet.js';
export type {
  MPCAgentWalletConfig,
  IMPCWallet,
  MPCWalletFactory,
  DKGProgressInfo,
  MPCKeyId,
} from './01-core/wallet/mpc-agent-wallet.js';

// UHRP Storage
export { AGIdentityStorageManager } from './02-storage/uhrp/storage-manager.js';
export type { StorageManagerConfig, UploadOptions } from './02-storage/uhrp/storage-manager.js';

// Local Encrypted Vault (fast, for Shad)
export { LocalEncryptedVault, createLocalEncryptedVault } from './02-storage/vault/index.js';
export type { LocalEncryptedVaultConfig } from './02-storage/vault/index.js';

// Shad Integration
export { EncryptedShadVault } from './04-integrations/shad/encrypted-vault.js';
export type { EncryptedVaultConfig } from './04-integrations/shad/encrypted-vault.js';

// New: ShadTempVaultExecutor (working implementation with correct CLI flags)
export { ShadTempVaultExecutor, createShadExecutor } from './04-integrations/shad/index.js';
export type {
  ShadTempVaultExecutorConfig,
  ShadExecuteOptions,
  ShadAvailability,
} from './04-integrations/shad/index.js';

// Deprecated: AGIdentityShadBridge (uses non-existent --retriever api)
export {
  AGIdentityShadBridge,
  createShadBridge,
  createShadBridgeWithLocalVault,
  createShadBridgeWithUHRP,
} from './04-integrations/shad/shad-integration.js';
export type { ShadBridgeConfig } from './04-integrations/shad/shad-integration.js';

// Encryption
export {
  PerInteractionEncryption,
  SessionEncryption,
} from './03-gateway/encryption/per-interaction.js';
export type {
  InteractionContext,
  EncryptedMessage,
  DecryptedMessage,
} from './03-gateway/encryption/per-interaction.js';

// Team/Group Encryption
export { TeamVault } from './04-integrations/team/team-vault.js';
export type { TeamVaultConfig } from './04-integrations/team/team-vault.js';
export { SecureTeamVault } from './04-integrations/team/secure-team-vault.js';
export type {
  SecureTeamVaultConfig,
  CertifiedTeamMember,
  CertifiedTeamConfig,
} from './04-integrations/team/secure-team-vault.js';

// Identity & Certificates (BRC-52/53)
export {
  CertificateAuthority,
  CertificateVerifier,
  IdentityGate,
  LocalCertificateIssuer,
  LocalRevocationChecker,
  gatedOperation,
  gatedOperationByKey,
} from './01-core/identity/index.js';
export type {
  CertificateAuthorityConfig,
  CertificateVerifierConfig,
  CertificateType,
  EmployeeCertificateFields,
  CertificateIssuanceRequest,
  IssuedCertificate,
  CertificateVerificationResult,
  IdentityGateConfig,
  IdentityVerificationResult,
  CertificateIssuer,
  RevocationChecker,
} from './01-core/identity/index.js';

// Server (BRC-103/104 Auth)
export { createAGIDServer } from './05-interfaces/server/index.js';
export type { AGIDServerConfig, AGIDServer } from './05-interfaces/server/index.js';

// Messaging (MessageBox Client)
export { AGIDMessageClient, createMessageClient } from './03-gateway/messaging/index.js';
export type {
  AGIDMessageConfig,
  AGIDMessage,
  AGIDPayment,
  AGIDPermission,
  AGIDQuote,
  MessageHandler,
  PaymentHandler,
} from './03-gateway/messaging/index.js';

// MessageBox Gateway (unified AI communication entry point)
export { MessageBoxGateway, createMessageBoxGateway } from './03-gateway/messaging/index.js';
export type {
  ProcessedMessage,
  ProcessingContext,
  MessageResponse,
  GatewayError,
  GatewayErrorType,
  MessageBoxGatewayConfig,
  CreateGatewayConfig,
} from './03-gateway/messaging/index.js';

// Unified Service
export { createAGIdentityService } from './05-interfaces/service/index.js';
export type { AGIdentityServiceConfig, AGIdentityService } from './05-interfaces/service/index.js';

// OpenClaw Gateway (WebSocket client for OpenClaw AI agent)
export { OpenClawClient, createOpenClawClient } from './04-integrations/openclaw/index.js';
export type { OpenClawClientConfig } from './04-integrations/openclaw/index.js';

// AGIdentity OpenClaw Gateway (full integration: MessageBox → Identity → OpenClaw → MPC Sign)
export {
  AGIdentityOpenClawGateway,
  createAGIdentityGateway,
} from './03-gateway/gateway/index.js';
export type {
  AGIdentityOpenClawGatewayConfig,
  SignedResponse,
  IdentityContext,
} from './03-gateway/gateway/index.js';

// Client SDK
export { AGIDClient, createAGIDClient } from './05-interfaces/client/index.js';
export type {
  AGIDClientConfig,
  APIResponse,
  IdentityInfo,
  SessionInfo,
  VaultInfo,
  StoredDocument,
  DocumentEntry,
  SearchResult,
  VaultProof,
  TeamInfo,
  TeamDetails,
  TeamMember,
  AccessCheck,
  TeamDocument,
  SignatureResult,
  VerificationResult,
  HealthStatus,
  SessionStatus,
} from './05-interfaces/client/index.js';

// Configuration
export { getConfig, loadConfig, resetConfig, getUhrpResolver, validateConfig } from './01-core/config/index.js';
export type { AGIdentityEnvConfig } from './01-core/config/index.js';

// Memory (core types and storage - server exports in future plan)
export type { MemoryInput, MemoryToken } from './02-storage/memory/index.js';

// TODO: Memory Server exports (planned for future):
// - AGIdentityMemoryServer, createAGIdentityMemoryServer
// - AGIdentityMemoryServerConfig, MCPToolResponse, MemorySearchResult

// ============================================================================
// Convenience Factory Functions
// ============================================================================

import type { AGIdentityConfig, BRC100Wallet } from './07-shared/types/index.js';
import { createAgentWallet } from './01-core/wallet/agent-wallet.js';
import { AGIdentityStorageManager } from './02-storage/uhrp/storage-manager.js';
import { EncryptedShadVault } from './04-integrations/shad/encrypted-vault.js';
import { createShadBridge, AGIdentityShadBridge } from './04-integrations/shad/shad-integration.js';
import { TeamVault } from './04-integrations/team/team-vault.js';

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
  const { wallet } = await createAgentWallet(config.agentWallet);

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

// Default export
export default createAGIdentity;
