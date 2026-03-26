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
import { corePlugin, type ToolDescriptor, type ToolContext, type ToolPlugin, type ToolCategory } from './tools/index.js';
import { PluginRegistry } from '../plugins/plugin-registry.js';
import { adaptNewResult } from '../plugins/result-adapter.js';

export class ToolRegistry {
  private tools = new Map<string, RegisteredTool>();
  private walletTools = new Set<string>();
  private toolCategories = new Map<string, ToolCategory>();
  private definitionsCache: AgentToolDefinition[] | null = null;

  register(tool: RegisteredTool): void {
    this.tools.set(tool.definition.name, tool);
    this.definitionsCache = null; // Invalidate cache
  }

  getDefinitions(): AgentToolDefinition[] {
    if (!this.definitionsCache) {
      this.definitionsCache = Array.from(this.tools.values()).map((t) => t.definition);
    }
    return this.definitionsCache;
  }

  getDefinitionsByCategories(categories: ToolCategory[] | null): AgentToolDefinition[] {
    if (!categories) return this.getDefinitions();
    return Array.from(this.tools.values())
      .filter(t => {
        const cat = this.toolCategories.get(t.definition.name);
        return cat && categories.includes(cat);
      })
      .map(t => t.definition);
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
    this.registerPlugin(corePlugin, ctx);
  }

  registerPlugin(plugin: ToolPlugin, ctx: ToolContext): void {
    this.registerAll(plugin.createTools(ctx), ctx);
  }

  registerPlugins(plugins: ToolPlugin[], ctx: ToolContext): void {
    for (const plugin of plugins) {
      this.registerPlugin(plugin, ctx);
    }
  }

  registerAll(descriptors: ToolDescriptor[], ctx: ToolContext): void {
    for (const desc of descriptors) {
      if (desc.requiresWallet) {
        this.walletTools.add(desc.definition.name);
      }
      if (desc.category) {
        this.toolCategories.set(desc.definition.name, desc.category);
      }
      this.register({
        definition: desc.definition,
        execute: (params) => desc.execute(params, ctx),
      });
    }
  }

  /**
   * Bridge: register all tools from the plugin registry into the old tool registry.
   * Uses the result adapter to convert new format to old format.
   */
  registerFromPluginRegistry(pluginRegistry: PluginRegistry): void {
    for (const pluginTool of pluginRegistry.getTools()) {
      const { registration } = pluginTool;

      if (this.tools.has(registration.name)) {
        console.warn(`[ToolRegistry] Tool '${registration.name}' already exists — skipping plugin tool`);
        continue;
      }

      if (registration.requiresWallet) {
        this.walletTools.add(registration.name);
      }

      this.register({
        definition: {
          name: registration.name,
          description: registration.description,
          input_schema: {
            type: 'object',
            properties: (registration.parameters?.properties ?? registration.parameters ?? {}) as Record<string, unknown>,
            required: registration.parameters?.required as string[] | undefined,
          },
        },
        execute: async (params) => {
          const result = await pluginRegistry.executeTool(registration.name, params);
          return adaptNewResult(result);
        },
      });
    }
    this.definitionsCache = null;
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
    if (optimized > 0) this.definitionsCache = null;
    return optimized;
  }
}
