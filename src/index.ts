/**
 * AGIdentity
 *
 * BSV blockchain wallet and identity for AI agents with native Anthropic agent core:
 * - BRC-100 wallet identity for AI agents
 * - Native Anthropic API agent loop (no OpenClaw dependency)
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

// AGIdentity Gateway (native agent loop: MessageBox → Identity → Anthropic API → MPC Sign)
export {
  AGIdentityGateway,
  createAGIdentityGateway,
} from './03-gateway/gateway/index.js';
export type {
  AGIdentityGatewayConfig,
  SignedResponse,
} from './03-gateway/gateway/index.js';
export type { IdentityContext } from './03-gateway/agent/index.js';

// Agent Core
export {
  ToolRegistry, PromptBuilder, SessionStore, AgentLoop,
  AnthropicProvider, OllamaProvider, createProvider, normalizeToCanonical,
} from './03-gateway/agent/index.js';
export type {
  PromptBuilderConfig, AgentLoopConfig, SessionStoreConfig,
  LLMProvider, LLMResponse, LLMMessage, LLMToolDef,
  CanonicalContent, CanonicalBlock, CanonicalTurn,
  ProviderConfig, ProviderType, OllamaProviderConfig,
} from './03-gateway/agent/index.js';

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

// PushDrop Token Operations (lock/unlock/decode BRC-48 tokens)
export {
  lockPushDropToken,
  unlockPushDropToken,
  decodePushDropToken,
} from './01-core/wallet/pushdrop-ops.js';
export type {
  LockTokenParams,
  LockTokenResult,
  UnlockTokenParams,
  UnlockTokenResult,
  DecodedToken,
} from './01-core/wallet/pushdrop-ops.js';

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
