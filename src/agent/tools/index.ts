/**
 * Tool Index
 *
 * Creates all tool descriptors for the AGIdentity agent.
 */

export type { ToolDescriptor, ToolContext, ToolPlugin } from './types.js';
export { ok } from './types.js';
export { corePlugin } from './core-plugin.js';

import type { ToolDescriptor, ToolContext } from './types.js';
import { identityTools } from './identity.js';
import { walletOpsTools } from './wallet-ops.js';
import { transactionTools } from './transactions.js';
import { tokenTools } from './tokens.js';
import { messagingTools } from './messaging.js';
import { memoryTools } from './memory.js';
import { serviceTools } from './services.js';
import { auditTools } from './audit.js';
import { deploymentTools } from './deployment.js';
import { certTools } from './certificates.js';
import { calibrationTools } from './calibration.js';

export function createAllTools(ctx: ToolContext): ToolDescriptor[] {
  const tools: ToolDescriptor[] = [
    ...identityTools(),
    ...walletOpsTools(),
    ...transactionTools(),
    ...tokenTools(),
    ...messagingTools(),
    ...serviceTools(),
    ...deploymentTools(),
    ...certTools(),
    ...calibrationTools(),
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

  return tools;
}
