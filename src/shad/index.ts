/**
 * Shad Integration Module
 *
 * Provides integration with Shannon's Daemon (Shad) for complex multi-step
 * reasoning tasks across encrypted vaults.
 *
 * **Recommended:** Use ShadTempVaultExecutor for working Shad integration.
 * The AGIdentityShadBridge is deprecated (uses non-existent CLI flags).
 *
 * @module agidentity/shad
 */

// Encrypted vault for UHRP-backed storage
export { EncryptedShadVault } from './encrypted-vault.js';
export type { EncryptedVaultConfig } from './encrypted-vault.js';

// New: ShadTempVaultExecutor (working implementation)
export { ShadTempVaultExecutor } from './shad-temp-executor.js';
export type {
  ShadTempVaultExecutorConfig,
  ShadExecuteOptions,
  ShadAvailability,
} from './shad-temp-executor.js';

// Deprecated: AGIdentityShadBridge (uses non-existent --retriever api)
export {
  AGIdentityShadBridge,
  createShadBridge,
  createShadBridgeWithLocalVault,
  createShadBridgeWithUHRP,
} from './shad-integration.js';
export type { ShadBridgeConfig } from './shad-integration.js';

// Re-export types from main types module for convenience
import type { ShadConfig } from '../types/index.js';
import type { LocalEncryptedVault } from '../vault/local-encrypted-vault.js';
import type { EncryptedShadVault } from './encrypted-vault.js';
import { ShadTempVaultExecutor, type ShadAvailability } from './shad-temp-executor.js';

/**
 * Factory function to create a Shad executor with graceful fallback.
 *
 * Returns null if Shad is not available on the system, allowing the caller
 * to fall back to the AGIdentity Memory Server for simple retrieval tasks.
 *
 * @example
 * ```typescript
 * const executor = await createShadExecutor({
 *   vault: localEncryptedVault,
 *   shadConfig: { strategy: 'research' }
 * });
 *
 * if (executor) {
 *   // Shad is available, use for complex reasoning
 *   const result = await executor.execute('Analyze patterns in my notes');
 * } else {
 *   // Shad not available, fall back to memory server
 *   console.log('Using memory server for retrieval');
 * }
 * ```
 *
 * @param config - Configuration for the Shad executor
 * @returns ShadTempVaultExecutor if Shad is available, null otherwise
 */
export async function createShadExecutor(config: {
  vault: LocalEncryptedVault | EncryptedShadVault;
  userPublicKey?: string;
  shadConfig?: Partial<ShadConfig>;
}): Promise<ShadTempVaultExecutor | null> {
  const executor = new ShadTempVaultExecutor(config);
  const availability: ShadAvailability = await executor.checkShadAvailable();

  if (!availability.available) {
    console.warn(
      `Shad not available: ${availability.error ?? 'Unknown error'}. ` +
        'Falling back to memory server for retrieval.'
    );
    return null;
  }

  return executor;
}
