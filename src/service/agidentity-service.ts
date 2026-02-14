/**
 * AGIdentity Unified Service
 *
 * Single entry point combining all AGIdentity components:
 * - Wallet (BRC-100)
 * - Storage (UHRP)
 * - Vault (Encrypted Shad)
 * - Encryption (Per-interaction)
 * - Identity Gate (Certificates)
 * - Team Vault (Group encryption)
 * - Auth Server (BRC-103/104)
 * - Messaging (MessageBox)
 */

import type { ShadConfig } from '../types/index.js';
import { createAgentWallet, AgentWallet, AgentWalletConfig } from '../wallet/agent-wallet.js';
import { AGIdentityStorageManager } from '../uhrp/storage-manager.js';
import { EncryptedShadVault } from '../shad/encrypted-vault.js';
import { createShadBridge, AGIdentityShadBridge } from '../shad/shad-integration.js';
import { PerInteractionEncryption } from '../encryption/per-interaction.js';
import { IdentityGate } from '../identity/identity-gate.js';
import { TeamVault } from '../team/team-vault.js';
import { SecureTeamVault } from '../team/secure-team-vault.js';
import { createAGIDServer, AGIDServer } from '../server/auth-server.js';
import { AGIDMessageClient, createMessageClient } from '../messaging/message-client.js';
import { getConfig } from '../config/index.js';

/**
 * Configuration for the unified AGIdentity service
 */
export interface AGIdentityServiceConfig {
  /**
   * Wallet configuration (required)
   */
  wallet: AgentWalletConfig;

  /**
   * UHRP storage URL (required)
   */
  storageUrl: string;

  /**
   * Network: 'mainnet' or 'testnet' (default: 'mainnet')
   */
  network?: 'mainnet' | 'testnet';

  /**
   * Server configuration (optional)
   */
  server?: {
    enabled?: boolean;
    port?: number;
    trustedCertifiers?: string[];
    allowUnauthenticated?: boolean;
    enableLogging?: boolean;
    logLevel?: 'debug' | 'info' | 'warn' | 'error';
  };

  /**
   * Messaging configuration (optional)
   */
  messaging?: {
    enabled?: boolean;
    messageBoxHost?: string;
    enableLogging?: boolean;
  };

  /**
   * Team vault configuration (optional)
   */
  teams?: {
    requireCertificates?: boolean;
    trustedCertifiers?: string[];
  };

  /**
   * Shad integration configuration (optional)
   */
  shad?: ShadConfig;

  /**
   * Identity gate configuration (optional)
   */
  identity?: {
    trustedCertifiers?: string[];
    requireCertificate?: boolean;
    cacheVerificationMs?: number;
  };
}

/**
 * The unified AGIdentity service interface
 */
export interface AGIdentityService {
  // Core components
  wallet: AgentWallet;
  storage: AGIdentityStorageManager;
  vault: EncryptedShadVault;
  shad: AGIdentityShadBridge;
  encryption: PerInteractionEncryption;
  identityGate: IdentityGate;
  teamVault: TeamVault | SecureTeamVault;

  // Optional components
  server: AGIDServer | null;
  messaging: AGIDMessageClient | null;

  // Identity
  getIdentityKey(): Promise<string>;

  // Lifecycle
  start(): Promise<void>;
  stop(): Promise<void>;

  // Status
  isRunning(): boolean;
}

/**
 * Create a unified AGIdentity service
 *
 * This is the main entry point for using AGIdentity. It initializes all
 * components and wires them together.
 *
 * @example
 * ```typescript
 * const agid = await createAGIdentityService({
 *   wallet: {
 *     privateKeyHex: process.env.AGENT_PRIVATE_KEY!,
 *     network: 'mainnet',
 *   },
 *   storageUrl: 'https://uhrp.example.com',
 *   server: {
 *     enabled: true,
 *     port: 3000,
 *     trustedCertifiers: ['03abc...'],
 *   },
 *   messaging: {
 *     enabled: true,
 *   },
 * });
 *
 * // Start the service
 * await agid.start();
 *
 * // Listen for messages
 * agid.messaging?.onMessage('commands', async (msg) => {
 *   console.log('Received:', msg.body);
 *   await agid.messaging?.acknowledgeMessage(msg.messageId);
 * });
 *
 * // Graceful shutdown
 * process.on('SIGINT', () => agid.stop());
 * ```
 */
export async function createAGIdentityService(
  config: AGIdentityServiceConfig
): Promise<AGIdentityService> {
  // Get environment defaults
  const envConfig = getConfig();

  // Initialize wallet
  const { wallet } = await createAgentWallet(config.wallet);
  const identityKey = (await wallet.getPublicKey({ identityKey: true })).publicKey;

  console.log(`AGIdentity initializing with identity: ${identityKey.slice(0, 16)}...`);

  // Initialize storage
  const storage = new AGIdentityStorageManager({
    storageUrl: config.storageUrl ?? envConfig.uhrpStorageUrl ?? '',
    wallet,
    network: config.network ?? envConfig.network,
  });

  // Initialize vault
  const vault = new EncryptedShadVault({
    storageManager: storage,
    wallet,
    cacheDir: envConfig.vaultCacheDir,
  });

  // Initialize Shad bridge
  const shad = createShadBridge(vault, wallet, config.shad);

  // Initialize encryption
  const encryption = new PerInteractionEncryption(wallet);

  // Collect trusted certifiers from all sources
  const trustedCertifiers = new Set<string>();
  if (config.identity?.trustedCertifiers) {
    config.identity.trustedCertifiers.forEach(c => trustedCertifiers.add(c));
  }
  if (config.server?.trustedCertifiers) {
    config.server.trustedCertifiers.forEach(c => trustedCertifiers.add(c));
  }
  if (config.teams?.trustedCertifiers) {
    config.teams.trustedCertifiers.forEach(c => trustedCertifiers.add(c));
  }

  // Initialize identity gate
  const identityGate = new IdentityGate({
    wallet,
    trustedCertifiers: Array.from(trustedCertifiers),
    requireCertificate: config.identity?.requireCertificate ?? true,
    cacheVerificationMs: config.identity?.cacheVerificationMs,
  });
  await identityGate.initialize();

  // Initialize team vault
  // Use SecureTeamVault if trustedCertifiers are provided and requireCertificates is set
  let teamVault: TeamVault | SecureTeamVault;
  if (config.teams?.requireCertificates && config.teams.trustedCertifiers?.length) {
    teamVault = new SecureTeamVault({
      wallet,
      trustedCertifiers: config.teams.trustedCertifiers,
    });
  } else {
    teamVault = new TeamVault({ wallet });
  }

  // Initialize server (optional)
  // Note: Server uses TeamVault (not SecureTeamVault) for HTTP API
  // SecureTeamVault requires Certificate objects which need separate handling
  let server: AGIDServer | null = null;
  if (config.server?.enabled !== false) {
    // If using SecureTeamVault, create a separate TeamVault for the server
    const serverTeamVault = teamVault instanceof SecureTeamVault
      ? new TeamVault({ wallet })
      : teamVault;

    server = await createAGIDServer({
      wallet,
      identityGate,
      vault,
      teamVault: serverTeamVault,
      port: config.server?.port ?? envConfig.serverPort,
      trustedCertifiers: config.server?.trustedCertifiers ?? envConfig.trustedCertifiers,
      allowUnauthenticated: config.server?.allowUnauthenticated ?? envConfig.allowUnauthenticated,
      enableLogging: config.server?.enableLogging ?? envConfig.serverLogging,
      logLevel: config.server?.logLevel ?? envConfig.serverLogLevel,
    });
  }

  // Initialize messaging (optional)
  // MessageBoxClient handles encryption internally via BRC-2 ECDH
  let messaging: AGIDMessageClient | null = null;
  if (config.messaging?.enabled !== false) {
    const network = config.network ?? envConfig.network;
    messaging = createMessageClient({
      wallet,
      messageBoxHost: config.messaging?.messageBoxHost ?? envConfig.messageBoxHost,
      enableLogging: config.messaging?.enableLogging ?? envConfig.messageBoxLogging,
      networkPreset: network === 'testnet' ? 'testnet' : 'mainnet',
    });
    await messaging.initialize();
  }

  let running = false;

  return {
    wallet,
    storage,
    vault,
    shad,
    encryption,
    identityGate,
    teamVault,
    server,
    messaging,

    async getIdentityKey() {
      return identityKey;
    },

    async start() {
      if (running) {
        console.log('AGIdentity service already running');
        return;
      }

      if (server) {
        await server.start();
      }

      running = true;

      console.log(`AGIdentity service started`);
      console.log(`  Identity: ${identityKey}`);
      if (server) {
        console.log(`  Server: http://localhost:${config.server?.port ?? 3000}`);
      }
      if (messaging) {
        console.log(`  Messaging: connected to ${config.messaging?.messageBoxHost ?? 'messagebox.babbage.systems'}`);
      }
    },

    async stop() {
      if (!running) {
        return;
      }

      console.log('Stopping AGIdentity service...');

      if (server) {
        await server.stop();
      }

      if (messaging) {
        await messaging.disconnect();
      }

      await wallet.destroy();
      running = false;

      console.log('AGIdentity service stopped');
    },

    isRunning() {
      return running;
    },
  };
}
