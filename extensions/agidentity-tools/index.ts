import type { OpenClawPluginApi } from 'openclaw/plugin-sdk';
import { createWalletTools } from './src/wallet-tools.js';

/**
 * AGIdentity OpenClaw Plugin
 *
 * Provides wallet and memory tools for OpenClaw AI agents.
 * Connects to AGIdentity gateway HTTP API for authenticated operations.
 */
export default function register(api: OpenClawPluginApi): void {
  // Get plugin configuration
  const config = api.pluginConfig as { gatewayUrl?: string; authToken?: string } | undefined;
  const gatewayUrl = config?.gatewayUrl ?? 'http://localhost:3000';

  api.logger.info('[AGIdentity] Plugin registered');
  api.logger.info(`[AGIdentity] Gateway URL: ${gatewayUrl}`);

  // Register wallet tools (requires explicit allowlist, disabled in sandbox mode)
  api.registerTool(
    (ctx) => (ctx.sandboxed ? null : createWalletTools({ gatewayUrl })),
    {
      names: ['agid_get_balance', 'agid_create_transaction'],
      optional: true,
    }
  );

  // Memory tools will be added in Task 3
}
