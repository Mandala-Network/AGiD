/**
 * Tool Index
 *
 * Creates all tool descriptors for the AGIdentity agent.
 */

export type { ToolDescriptor, ToolContext, ToolPlugin, ToolCategory } from './types.js';
export { ok } from './types.js';
export { corePlugin } from './core-plugin.js';

import type { ToolDescriptor, ToolContext } from './types.js';
import { identityTools } from './identity.js';
import { walletOpsTools } from './wallet-ops.js';
import { walletClientTools } from './wallet-client.js';
import { transactionTools } from './transactions.js';
import { tokenTools } from './tokens.js';
import { memoryTools } from './memory.js';
import { xResearchTools } from './x-research.js';
import { auditTools } from './audit.js';
import { deploymentTools } from './deployment.js';
import { certTools } from './certificates.js';
import { calibrationTools } from './calibration.js';
import { shadTools } from './shad.js';
import { zkproofTools } from './zkproof-ops.js';
import { skillCreatorTools } from './skill-creator.js';

export function createAllTools(ctx: ToolContext): ToolDescriptor[] {
  // Migrated to plugins: messaging (agid-messaging), services (agid-optimize)
  // Removed tools: agid_discover_services, agid_x402_request, agid_overlay_lookup
  const tools: ToolDescriptor[] = [
    ...identityTools(),
    ...walletOpsTools(),
    ...walletClientTools(),
    ...transactionTools(),
    ...tokenTools(),
    ...xResearchTools(),
    ...deploymentTools(),
    ...certTools(),
    ...calibrationTools(),
    ...zkproofTools(),
  ];

  if (ctx.memoryManager) {
    tools.push(...memoryTools());
  }

  if (ctx.workspacePath) {
    tools.push(...auditTools().filter(t => t.definition.name === 'agid_verify_workspace'));
  }

  if (ctx.sessionsPath) {
    tools.push(...auditTools().filter(t => t.definition.name === 'agid_verify_session'));
  }

  if (ctx.memoryManager) {
    tools.push(...shadTools());
  }

  if (ctx.skillStore) {
    tools.push(...skillCreatorTools());
  }

  return tools;
}
