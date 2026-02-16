/**
 * AGIdentity Configuration
 *
 * Centralized configuration loading from environment variables.
 * Use this module to access configuration throughout the application.
 */

/**
 * Environment configuration interface
 */
export interface AGIdentityEnvConfig {
  // Wallet
  agentPrivateKey?: string;
  network: 'mainnet' | 'testnet';
  walletPath: string;

  // UHRP Storage
  uhrpStorageUrl: string;

  // Obsidian Vault (Local Encrypted)
  obsidianVaultPath?: string;
  vaultAutoWarmup: boolean;
  vaultEncryptedDir: string;

  // Shad
  shadPath: string;
  shadPythonPath: string;
  shadStrategy: 'software' | 'research' | 'analysis' | 'planning';
  shadMaxDepth: number;
  shadMaxNodes: number;
  shadMaxTime: number;

  // MessageBox
  messageBoxHost: string;
  messageBoxLogging: boolean;

  // Server
  serverPort: number;
  allowUnauthenticated: boolean;
  serverLogging: boolean;
  serverLogLevel: 'debug' | 'info' | 'warn' | 'error';

  // Identity
  trustedCertifiers: string[];
  requireCertificates: boolean;
  certificateCacheMs: number;

  // Teams
  teamRequireCertificates: boolean;

  // Advanced
  vaultCacheDir: string;
  defaultRetentionDays: number;
}

/**
 * Parse a boolean from environment variable
 */
function parseBool(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value === '') return defaultValue;
  return value.toLowerCase() === 'true' || value === '1';
}

/**
 * Parse an integer from environment variable
 */
function parseInt(value: string | undefined, defaultValue: number): number {
  if (value === undefined || value === '') return defaultValue;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Parse a comma-separated list from environment variable
 */
function parseList(value: string | undefined): string[] {
  if (value === undefined || value === '') return [];
  return value.split(',').map(s => s.trim()).filter(s => s.length > 0);
}

/**
 * Load configuration from environment variables
 */
export function loadConfig(): AGIdentityEnvConfig {
  const env = process.env;

  return {
    // Wallet
    agentPrivateKey: env.AGENT_PRIVATE_KEY,
    network: (env.AGID_NETWORK === 'testnet' ? 'testnet' : 'mainnet'),
    walletPath: env.AGENT_WALLET_PATH ?? './agent-wallet.sqlite',

    // UHRP Storage (upload endpoint - downloads use overlay lookup resolver automatically)
    uhrpStorageUrl: env.UHRP_STORAGE_URL ?? 'https://go-uhrp.b1nary.cloud',

    // Obsidian Vault (Local Encrypted)
    obsidianVaultPath: env.OBSIDIAN_VAULT_PATH,
    vaultAutoWarmup: parseBool(env.VAULT_AUTO_WARMUP, true),
    vaultEncryptedDir: env.VAULT_ENCRYPTED_DIR ?? '.agid',

    // Shad
    shadPath: env.SHAD_PATH ?? '~/.shad',
    shadPythonPath: env.SHAD_PYTHON_PATH ?? 'python3',
    shadStrategy: (env.SHAD_STRATEGY as 'software' | 'research' | 'analysis' | 'planning') ?? 'research',
    shadMaxDepth: parseInt(env.SHAD_MAX_DEPTH, 3),
    shadMaxNodes: parseInt(env.SHAD_MAX_NODES, 50),
    shadMaxTime: parseInt(env.SHAD_MAX_TIME, 300),

    // MessageBox
    messageBoxHost: env.MESSAGEBOX_HOST ?? 'https://messagebox.babbage.systems',
    messageBoxLogging: parseBool(env.MESSAGEBOX_LOGGING, false),

    // Server
    serverPort: parseInt(env.AGID_SERVER_PORT, 3000),
    allowUnauthenticated: parseBool(env.AGID_ALLOW_UNAUTHENTICATED, false),
    serverLogging: parseBool(env.AGID_SERVER_LOGGING, false),
    serverLogLevel: (env.AGID_SERVER_LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error') ?? 'info',

    // Identity
    trustedCertifiers: parseList(env.TRUSTED_CERTIFIERS),
    requireCertificates: parseBool(env.REQUIRE_CERTIFICATES, true),
    certificateCacheMs: parseInt(env.CERTIFICATE_CACHE_MS, 60000),

    // Teams
    teamRequireCertificates: parseBool(env.TEAM_REQUIRE_CERTIFICATES, false),

    // Advanced
    vaultCacheDir: env.VAULT_CACHE_DIR ?? '/tmp/agidentity-vault-cache',
    defaultRetentionDays: parseInt(env.DEFAULT_RETENTION_DAYS, 365),
  };
}

/**
 * Cached configuration instance
 */
let cachedConfig: AGIdentityEnvConfig | null = null;

/**
 * Get configuration (loads once and caches)
 */
export function getConfig(): AGIdentityEnvConfig {
  if (!cachedConfig) {
    cachedConfig = loadConfig();
  }
  return cachedConfig;
}

/**
 * Reset cached configuration (useful for testing)
 */
export function resetConfig(): void {
  cachedConfig = null;
}

/**
 * Get UHRP storage URL (same for uploads and downloads - overlay handles resolution)
 * @deprecated Use getConfig().uhrpStorageUrl directly
 */
export function getUhrpResolver(_network: 'mainnet' | 'testnet'): string {
  const config = getConfig();
  // UHRP storage URL handles both uploads and lookups via overlay network
  return config.uhrpStorageUrl;
}

/**
 * Validate required configuration
 */
export function validateConfig(config: AGIdentityEnvConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!config.agentPrivateKey) {
    errors.push('AGENT_PRIVATE_KEY is required');
  } else if (!/^[0-9a-fA-F]{64}$/.test(config.agentPrivateKey)) {
    errors.push('AGENT_PRIVATE_KEY must be a 64-character hex string');
  }

  if (!config.uhrpStorageUrl) {
    errors.push('UHRP_STORAGE_URL is required');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
