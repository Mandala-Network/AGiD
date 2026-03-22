/**
 * Wallet Initialization
 *
 * Lazily initializes a BSV wallet via @bsv/wallet-toolbox.
 * Creates local SQLite storage on first run, generates keys automatically.
 */

import { WalletToolbox } from '@bsv/wallet-toolbox';

export interface WalletConfig {
  storage: 'local' | 'cloud';
  network: 'mainnet' | 'testnet';
  storagePath: string;
}

const DEFAULT_CONFIG: WalletConfig = {
  storage: 'local',
  network: 'testnet',
  storagePath: '~/.agid/wallet.sqlite',
};

let walletInstance: any = null;

/**
 * Initialize or return the cached wallet instance.
 * Keys are generated on first run and persisted in SQLite.
 */
export async function initWallet(config: Partial<WalletConfig> = {}): Promise<any> {
  if (walletInstance) return walletInstance;

  const resolved: WalletConfig = { ...DEFAULT_CONFIG, ...config };

  // Resolve ~ to home directory
  const storagePath = resolved.storagePath.replace(/^~/, process.env.HOME || '/tmp');

  walletInstance = await WalletToolbox.createWallet({
    chain: resolved.network,
    storageType: resolved.storage === 'cloud' ? 'cloud' : 'local',
    storagePath,
  });

  return walletInstance;
}

/**
 * Destroy the wallet instance and clean up resources.
 */
export async function destroyWallet(): Promise<void> {
  if (walletInstance) {
    if (typeof walletInstance.destroy === 'function') {
      await walletInstance.destroy();
    }
    walletInstance = null;
  }
}
