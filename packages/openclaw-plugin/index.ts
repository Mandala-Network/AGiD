/**
 * @agid/openclaw-plugin
 *
 * Packages all AGiD builtin plugins as a single OpenClaw-compatible extension.
 * Lazy-initializes a BSV wallet via @bsv/wallet-toolbox on first use.
 */

import { initWallet, destroyWallet } from './src/wallet-init.js';
import { resolveConfig } from './src/config.js';

// Import only the plugins that provide AGiD's unique value (identity, crypto,
// wallet, messaging, memory, audit).  OpenClaw already ships its own shell,
// file-system, and browser tools, so agid-runtime, agid-fs, and agid-browser
// are omitted.  agid-optimize (GEPA) and agid-deploy (Mandala infra) are
// outside the plugin's scope.
import {
  agidAuditPlugin,
  agidMessagingPlugin,
  agidCryptoPlugin,
  agidWalletPlugin,
  agidMemoryPlugin,
  agidIdentityPlugin,
} from 'agidentity/plugins/builtin';

const ALL_PLUGINS = [
  agidAuditPlugin,
  agidMessagingPlugin,
  agidCryptoPlugin,
  agidWalletPlugin,
  agidMemoryPlugin,
  agidIdentityPlugin,
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
    // Resolve and validate config
    const resolvedConfig = await resolveConfig(api.config ?? {}, api.prompt);

    // Lazy wallet initialization — only init when a tool actually needs it
    let walletPromise: Promise<any> | null = null;
    const getWallet = async () => {
      if (!walletPromise) {
        walletPromise = initWallet({
          network: resolvedConfig.network,
          storage: resolvedConfig.storage,
          storagePath: resolvedConfig.storagePath,
        });
      }
      return walletPromise;
    };

    // Tools to exclude from the OpenClaw plugin (maintenance utilities
    // that don't belong in the public distribution).
    const EXCLUDED_TOOLS = new Set([
      'agid_gc_legacy_tokens',
    ]);

    // Create a proxy API that passes wallet context to tools
    const proxyApi = {
      registerTool(tool: any, options?: any) {
        if (EXCLUDED_TOOLS.has(tool.name)) return;

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
