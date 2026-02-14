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
  uhrpStorageUrl?: string;
  uhrpMainnetResolver: string;
  uhrpTestnetResolver: string;

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

    // UHRP Storage
    uhrpStorageUrl: env.UHRP_STORAGE_URL,
    uhrpMainnetResolver: env.UHRP_MAINNET_RESOLVER ?? 'https://uhrp.network/resolve',
    uhrpTestnetResolver: env.UHRP_TESTNET_RESOLVER ?? 'https://testnet.uhrp.network/resolve',

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
 * Get UHRP resolver URL based on network
 */
export function getUhrpResolver(network: 'mainnet' | 'testnet'): string {
  const config = getConfig();
  return network === 'testnet' ? config.uhrpTestnetResolver : config.uhrpMainnetResolver;
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
