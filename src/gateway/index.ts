/**
 * Gateway Module
 *
 * AGIdentity Gateway - bridges MessageBox, IdentityGate, native agent loop, and MPC signing.
 */

export {
  AGIdentityGateway,
  type AGIdentityGatewayConfig,
  type SignedResponse,
} from './agidentity-gateway.js';

export { type IdentityContext } from '../agent/prompt-builder.js';

import type { AGIdentityGatewayConfig } from './agidentity-gateway.js';
import { AGIdentityGateway } from './agidentity-gateway.js';

/**
 * Create a fully initialized AGIdentity Gateway
 *
 * Factory function that creates and initializes the gateway, connecting
 * all components: MessageBox, IdentityGate, agent loop, and audit trail.
 *
 * @param config - Gateway configuration
 * @returns Initialized AGIdentityGateway
 */
export async function createAGIdentityGateway(
  config: AGIdentityGatewayConfig
): Promise<AGIdentityGateway> {
  const gateway = new AGIdentityGateway(config);
  await gateway.initialize();
  return gateway;
}
