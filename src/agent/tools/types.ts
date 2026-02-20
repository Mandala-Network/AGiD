/**
 * Tool Descriptor Types
 *
 * Declarative tool definition format for the AGIdentity agent.
 */

import type { AgentToolDefinition, ToolResult } from '../../types/agent-types.js';
import type { AgentWallet } from '../../wallet/agent-wallet.js';
import type { MemoryManager } from '../../storage/memory/memory-manager.js';

export interface ToolDescriptor {
  definition: AgentToolDefinition;
  execute: (params: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
  requiresWallet: boolean;
}

export interface ToolContext {
  wallet: AgentWallet;
  workspacePath?: string;
  sessionsPath?: string;
  memoryManager?: MemoryManager;
}

export function ok(data: Record<string, unknown>): ToolResult {
  return { content: JSON.stringify(data, null, 2) };
}
