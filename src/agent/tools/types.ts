/**
 * Tool Descriptor Types
 *
 * Declarative tool definition format for the AGIdentity agent.
 */

import type { AgentToolDefinition, ToolResult } from '../../types/agent-types.js';
import type { AgentWallet } from '../../wallet/agent-wallet.js';
import type { MemoryManager } from '../../storage/memory/memory-manager.js';
import type { SkillStore } from '../skills/skill-store.js';
import type { GepaOptimizer } from '../../integrations/gepa/gepa-optimizer.js';
import type { PromptBuilder } from '../prompt-builder.js';

export type ToolCategory = 'identity' | 'crypto' | 'memory' | 'zkproof' | 'messaging' | 'transactions' | 'tokens' | 'calibration' | 'services' | 'research' | 'audit' | 'deployment' | 'shad' | 'skills';

export interface ToolDescriptor {
  definition: AgentToolDefinition;
  execute: (params: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
  requiresWallet: boolean;
  category?: ToolCategory;
}

export interface ToolContext {
  wallet: AgentWallet;
  workspacePath?: string;
  sessionsPath?: string;
  memoryManager?: MemoryManager;
  skillStore?: SkillStore;
  gepaOptimizer?: GepaOptimizer;
  promptBuilder?: PromptBuilder;
}

export function ok(data: Record<string, unknown>): ToolResult {
  return { content: JSON.stringify(data, null, 2) };
}

export interface ToolPlugin {
  name: string;
  version: string;
  description: string;
  createTools: (ctx: ToolContext) => ToolDescriptor[];
}
