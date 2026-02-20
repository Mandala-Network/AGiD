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
export * from './types/index.js';

// Wallet
export { AgentWallet, createAgentWallet } from './wallet/agent-wallet.js';
export type { AgentWalletConfig, WalletBalanceInfo } from './wallet/agent-wallet.js';

// UHRP Storage
export { AGIdentityStorageManager } from './storage/uhrp/storage-manager.js';
export type { StorageManagerConfig, UploadOptions } from './storage/uhrp/storage-manager.js';

// Local Encrypted Vault (fast, for Shad)
export { LocalEncryptedVault, createLocalEncryptedVault } from './storage/vault/index.js';
export type { LocalEncryptedVaultConfig } from './storage/vault/index.js';

// Shad Integration
export { ShadVaultAdapter } from './integrations/shad/shad-vault-adapter.js';
export { EncryptedShadVault } from './integrations/shad/encrypted-vault.js';
export type { EncryptedVaultConfig } from './integrations/shad/encrypted-vault.js';

// New: ShadTempVaultExecutor (working implementation with correct CLI flags)
export { ShadTempVaultExecutor, createShadExecutor } from './integrations/shad/index.js';
export type {
  ShadTempVaultExecutorConfig,
  ShadExecuteOptions,
  ShadAvailability,
} from './integrations/shad/index.js';

// GEPA Integration (evolutionary prompt optimization)
export { GepaExecutor } from './integrations/gepa/index.js';
export type { GepaOptimizeParams, GepaResult, GepaAvailability, GepaExecutorConfig } from './integrations/gepa/index.js';

// x402 Integration (authenticated payment requests to x402 services)
export { X402Client } from './integrations/x402/index.js';
export type { X402ClientConfig, X402ServiceInfo } from './integrations/x402/index.js';

// Overlay Integration (generic SHIP/SLAP overlay lookup)
export { OverlayClient } from './integrations/overlay/index.js';
export type { OverlayClientConfig, OverlayOutput } from './integrations/overlay/index.js';

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

// Team/Group Encryption
export { TeamVaultAdapter } from './integrations/team/team-vault-adapter.js';
export { TeamVault } from './integrations/team/team-vault.js';
export type { TeamVaultConfig } from './integrations/team/team-vault.js';
export { SecureTeamVault } from './integrations/team/secure-team-vault.js';
export type {
  SecureTeamVaultConfig,
  CertifiedTeamMember,
  CertifiedTeamConfig,
} from './integrations/team/secure-team-vault.js';

// Identity & Certificates (BRC-52/53)
export {
  CertificateAuthority,
  CertificateVerifier,
  IdentityGate,
  LocalCertificateIssuer,
  LocalRevocationChecker,
  gatedOperation,
  gatedOperationByKey,
} from './identity/index.js';
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
} from './identity/index.js';

// Messaging (MessageBox Client)
export { AGIDMessageClient, createMessageClient } from './messaging/index.js';
export type {
  AGIDMessageConfig,
  AGIDMessage,
  AGIDPayment,
  AGIDPermission,
  AGIDQuote,
  MessageHandler,
  PaymentHandler,
} from './messaging/index.js';

// MessageBox Gateway (unified AI communication entry point)
export { MessageBoxGateway, createMessageBoxGateway } from './messaging/index.js';
export type {
  ProcessedMessage,
  ProcessingContext,
  MessageResponse,
  GatewayError,
  GatewayErrorType,
  MessageBoxGatewayConfig,
  CreateGatewayConfig,
} from './messaging/index.js';

// AGIdentity Gateway (native agent loop: MessageBox → Identity → Anthropic API → MPC Sign)
export {
  AGIdentityGateway,
  createAGIdentityGateway,
} from './gateway/index.js';
export type {
  AGIdentityGatewayConfig,
  SignedResponse,
} from './gateway/index.js';
export type { IdentityContext } from './agent/index.js';

// Agent Core
export {
  ToolRegistry, PromptBuilder, SessionStore, AgentLoop,
  AnthropicProvider, OllamaProvider, createProvider, normalizeToCanonical,
} from './agent/index.js';
export type {
  PromptBuilderConfig, AgentLoopConfig, SessionStoreConfig,
  LLMProvider, LLMResponse, LLMMessage, LLMToolDef,
  CanonicalContent, CanonicalBlock, CanonicalTurn,
  ProviderConfig, ProviderType, OllamaProviderConfig,
} from './agent/index.js';

// Client SDK
export { AGIDClient, createAGIDClient } from './client/index.js';
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
} from './client/index.js';

// Configuration
export { getConfig, loadConfig, resetConfig, validateConfig } from './config/index.js';
export type { AGIdentityEnvConfig } from './config/index.js';

// PushDrop Token Operations (lock/unlock/decode BRC-48 tokens)
export {
  lockPushDropToken,
  unlockPushDropToken,
  decodePushDropToken,
} from './wallet/pushdrop-ops.js';
export type {
  LockTokenParams,
  LockTokenResult,
  UnlockTokenParams,
  UnlockTokenResult,
  DecodedToken,
} from './wallet/pushdrop-ops.js';

// Memory (core types, storage, and manager)
export type { MemoryInput, MemoryToken } from './storage/memory/index.js';
export { MemoryManager } from './storage/memory/memory-manager.js';
export type { MemoryManagerOptions, RecallOptions, RecallResult } from './storage/memory/memory-manager.js';

// TODO: Memory Server exports (planned for future):
// - AGIdentityMemoryServer, createAGIdentityMemoryServer
// - AGIdentityMemoryServerConfig, MCPToolResponse, MemorySearchResult

// ============================================================================
// Convenience Factory Functions
// ============================================================================

import type { AGIdentityConfig, BRC100Wallet } from './types/index.js';
import { createAgentWallet } from './wallet/agent-wallet.js';
import { AGIdentityStorageManager } from './storage/uhrp/storage-manager.js';
import { EncryptedShadVault } from './integrations/shad/encrypted-vault.js';
import { TeamVault } from './integrations/team/team-vault.js';

/**
 * AGIdentity instance with all components initialized
 */
export interface AGIdentityInstance {
  wallet: BRC100Wallet;
  storage: AGIdentityStorageManager;
  vault: EncryptedShadVault;
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

  // Initialize team vault for group encryption
  const team = new TeamVault({ wallet });

  return {
    wallet,
    storage,
    vault,
    team,
    config
  };
}

// Default export
export default createAGIdentity;
