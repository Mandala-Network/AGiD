import type { OpenClawPluginApi } from 'openclaw/plugin-sdk';

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

  // Tool registration will be added in subsequent tasks
  // - Wallet tools (Task 2)
  // - Memory tools (Task 3)
}
