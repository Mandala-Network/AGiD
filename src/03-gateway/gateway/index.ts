/**
 * Gateway Module
 *
 * AGIdentity OpenClaw Gateway - bridges MessageBox, IdentityGate, OpenClaw, and MPC signing.
 */

export {
  AGIdentityOpenClawGateway,
  type AGIdentityOpenClawGatewayConfig,
  type SignedResponse,
  type IdentityContext,
} from './agidentity-openclaw-gateway.js';

import type { AGIdentityOpenClawGatewayConfig } from './agidentity-openclaw-gateway.js';
import { AGIdentityOpenClawGateway } from './agidentity-openclaw-gateway.js';

/**
 * Create a fully initialized AGIdentity Gateway
 *
 * Factory function that creates and initializes the gateway, connecting
 * all components: MessageBox, IdentityGate, OpenClaw, and audit trail.
 *
 * @example
 * ```typescript
 * import { createAGIdentityGateway } from 'agidentity';
 *
 * const gateway = await createAGIdentityGateway({
 *   wallet,
 *   trustedCertifiers: [caPublicKey],
 *   // OpenClaw config (optional, uses env vars by default)
 *   openclawUrl: process.env.OPENCLAW_GATEWAY_URL,
 *   openclawToken: process.env.OPENCLAW_GATEWAY_TOKEN,
 * });
 *
 * // Gateway is now listening for messages
 * // All messages are verified, responses are signed
 *
 * await gateway.shutdown();
 * ```
 *
 * @param config - Gateway configuration
 * @returns Initialized AGIdentityOpenClawGateway
 */
export async function createAGIdentityGateway(
  config: AGIdentityOpenClawGatewayConfig
): Promise<AGIdentityOpenClawGateway> {
  const gateway = new AGIdentityOpenClawGateway(config);
  await gateway.initialize();
  return gateway;
}
