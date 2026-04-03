/**
 * @agid/openclaw-plugin
 *
 * Packages all AGiD builtin plugins as a single OpenClaw-compatible extension.
 * Lazy-initializes a BSV wallet via @bsv/wallet-toolbox on first use.
 */

import { initWallet, destroyWallet } from './src/wallet-init.js';
import { resolveConfig } from './src/config.js';
import { MemoryManager } from 'agidentity';

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

let memoryManagerInstance: MemoryManager | null = null;

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

    // Lazy MemoryManager initialization — only init when a memory tool is called
    const getMemoryManager = async () => {
      if (!memoryManagerInstance) {
        const wallet = await getWallet();
        memoryManagerInstance = new MemoryManager(wallet, {
          workspacePath: resolvedConfig.storagePath,
        });
      }
      return memoryManagerInstance;
    };

    // Tools to exclude from the OpenClaw plugin (maintenance utilities
    // that don't belong in the public distribution, and Shad tools
    // since Shad is not included in the plugin).
    const EXCLUDED_TOOLS = new Set([
      'agid_gc_legacy_tokens',
      'shad_deep_recall',
      'shad_search_memories',
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
            // Ensure MemoryManager is initialized for memory tools
            if (options?.group === 'memory') {
              await getMemoryManager();
            }
            return originalExecute(id, params, ctx);
          },
        };
        api.registerTool(wrappedTool, options);
      },
      config: api.config,
      agid: {
        get memoryManager() { return memoryManagerInstance; },
        wallet: null,
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
    memoryManagerInstance = null;
    await destroyWallet();
    // Destroy any plugins that have cleanup
    for (const plugin of ALL_PLUGINS) {
      if (plugin.destroy) {
        await plugin.destroy();
      }
    }
  },
};
