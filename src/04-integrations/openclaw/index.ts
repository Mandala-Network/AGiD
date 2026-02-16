/**
 * OpenClaw Gateway Module
 *
 * Provides WebSocket client for communicating with OpenClaw Gateway.
 */

export { OpenClawClient, type OpenClawClientConfig } from './openclaw-client.js';

/**
 * Create and connect an OpenClawClient
 *
 * Factory function that creates a new OpenClawClient and establishes connection
 * to the OpenClaw Gateway. Connection includes the challenge-response handshake.
 *
 * @example
 * ```typescript
 * import { createOpenClawClient } from 'agidentity';
 *
 * // Using environment variables
 * const client = await createOpenClawClient();
 *
 * // Or with explicit config
 * const client = await createOpenClawClient({
 *   gatewayUrl: 'ws://127.0.0.1:18789',
 *   authToken: 'your-token',
 * });
 *
 * // Send a message
 * await client.sendChat('Hello!');
 *
 * // Disconnect when done
 * await client.disconnect();
 * ```
 *
 * @param config - Optional configuration (defaults from environment variables)
 * @returns Connected OpenClawClient instance
 * @throws If connection fails or authentication fails
 */
import type { OpenClawClientConfig } from './openclaw-client.js';
import { OpenClawClient } from './openclaw-client.js';

export async function createOpenClawClient(
  config?: OpenClawClientConfig
): Promise<OpenClawClient> {
  const client = new OpenClawClient(config);
  await client.connect();
  return client;
}
