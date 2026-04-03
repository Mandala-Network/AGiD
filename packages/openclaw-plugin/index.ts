/**
 * @agid/openclaw-plugin
 *
 * Packages all AGiD builtin plugins as a single OpenClaw-compatible extension.
 * Lazy-initializes a BSV wallet via @bsv/wallet-toolbox on first use.
 */

import { initWallet, destroyWallet } from './src/wallet-init.js';
import type { WalletConfig } from './src/wallet-init.js';

// Import all builtin plugin definitions
// These are re-exported from the main agidentity package
import { agidAuditPlugin } from '../../src/plugins/builtin/agid-audit.js';
import { agidOptimizePlugin } from '../../src/plugins/builtin/agid-optimize.js';
import { agidMessagingPlugin } from '../../src/plugins/builtin/agid-messaging.js';
import { agidCryptoPlugin } from '../../src/plugins/builtin/agid-crypto.js';
import { agidWalletPlugin } from '../../src/plugins/builtin/agid-wallet.js';
import { agidMemoryPlugin } from '../../src/plugins/builtin/agid-memory.js';
import { agidIdentityPlugin } from '../../src/plugins/builtin/agid-identity.js';
import { agidDeployPlugin } from '../../src/plugins/builtin/agid-deploy.js';
import { agidRuntimePlugin } from '../../src/plugins/builtin/agid-runtime.js';
import { agidFsPlugin } from '../../src/plugins/builtin/agid-fs.js';
import { agidBrowserPlugin } from '../../src/plugins/builtin/agid-browser.js';

const ALL_PLUGINS = [
  agidAuditPlugin,
  agidOptimizePlugin,
  agidMessagingPlugin,
  agidCryptoPlugin,
  agidWalletPlugin,
  agidMemoryPlugin,
  agidIdentityPlugin,
  agidDeployPlugin,
  agidRuntimePlugin,
  agidFsPlugin,
  agidBrowserPlugin,
];

/**
 * OpenClaw plugin entry point.
 *
 * When loaded by OpenClaw, this registers all AGiD tools and lazily
 * initializes a BSV wallet for tools that require one.
 */
export default {
  id: 'agid',
  name: 'AGiD — Auditable Agent Identity',

  async register(api: any) {
    // Read config from OpenClaw
    const config: Partial<WalletConfig> = api.config ?? {};

    // Lazy wallet initialization — only init when a tool actually needs it
    let walletPromise: Promise<any> | null = null;
    const getWallet = async () => {
      if (!walletPromise) {
        walletPromise = initWallet(config);
      }
      return walletPromise;
    };

    // Create a proxy API that passes wallet context to tools
    const proxyApi = {
      registerTool(tool: any, options?: any) {
        const originalExecute = tool.execute;
        const wrappedTool = {
          ...tool,
          async execute(id: string, params: any, ctx: any) {
            // If the tool requires a wallet, ensure one is available
            if (tool.requiresWallet) {
              const wallet = await getWallet();
              ctx = { ...ctx, wallet };
            }
            return originalExecute(id, params, ctx);
          },
        };
        api.registerTool(wrappedTool, options);
      },
      config: api.config,
      agid: {
        wallet: null, // Will be set lazily
        audit: null,
        identity: null,
      },
    };

    // Register all builtin plugins through the proxy
    for (const plugin of ALL_PLUGINS) {
      plugin.register(proxyApi);
    }
  },

  async destroy() {
    await destroyWallet();
    // Destroy any plugins that have cleanup
    for (const plugin of ALL_PLUGINS) {
      if (plugin.destroy) {
        await plugin.destroy();
      }
    }
  },
};
