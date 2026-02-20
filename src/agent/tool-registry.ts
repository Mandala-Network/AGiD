/**
 * Tool Registry
 *
 * Thin registry that maps tool names to descriptors.
 * Domain-specific tools are defined in tools/ subdirectory.
 */

import type { AgentWallet } from '../wallet/agent-wallet.js';
import type { AgentToolDefinition, RegisteredTool, ToolResult } from '../types/agent-types.js';
import type { MemoryManager } from '../storage/memory/memory-manager.js';
import type { GepaOptimizer } from '../integrations/gepa/gepa-optimizer.js';
import { createAllTools, type ToolDescriptor, type ToolContext } from './tools/index.js';

export class ToolRegistry {
  private tools = new Map<string, RegisteredTool>();
  private walletTools = new Set<string>();

  register(tool: RegisteredTool): void {
    this.tools.set(tool.definition.name, tool);
  }

  getDefinitions(): AgentToolDefinition[] {
    return Array.from(this.tools.values()).map((t) => t.definition);
  }

  requiresWallet(name: string): boolean {
    return this.walletTools.has(name);
  }

  async execute(name: string, params: Record<string, unknown>): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { content: JSON.stringify({ error: `Unknown tool: ${name}` }), isError: true };
    }
    try {
      return await tool.execute(params);
    } catch (error) {
      return {
        content: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
        isError: true,
      };
    }
  }

  registerBuiltinTools(wallet: AgentWallet, workspacePath?: string, sessionsPath?: string, memoryManager?: MemoryManager): void {
    const ctx: ToolContext = { wallet, workspacePath, sessionsPath, memoryManager };
    this.registerAll(createAllTools(ctx), ctx);
  }

  registerAll(descriptors: ToolDescriptor[], ctx: ToolContext): void {
    for (const desc of descriptors) {
      if (desc.requiresWallet) {
        this.walletTools.add(desc.definition.name);
      }
      this.register({
        definition: desc.definition,
        execute: (params) => desc.execute(params, ctx),
      });
    }
  }

  /**
   * GEPA-optimize all registered tool descriptions in-place.
   * Called once after registerBuiltinTools() during gateway initialization.
   */
  async optimizeDescriptions(optimizer: GepaOptimizer): Promise<number> {
    let optimized = 0;
    for (const tool of this.tools.values()) {
      const original = tool.definition.description;
      const result = await optimizer.optimizeToolDescription(tool.definition.name, original);
      if (result !== original) {
        tool.definition.description = result;
        optimized++;
      }
    }
    return optimized;
  }
}
