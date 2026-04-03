/**
 * Plugin Registry
 *
 * Central registry that loads plugins, collects their tools,
 * and provides tool execution with error handling and timeout.
 */

import { createPluginAPI } from './plugin-api.js';
import type {
  PluginDefinition,
  PluginManifest,
  PluginToolResult,
  RegisteredPluginTool,
  LoadedPlugin,
  AGiDExtensions,
} from './types.js';
import { randomUUID } from 'crypto';

export interface LoadPluginInput {
  manifest: PluginManifest;
  definition: PluginDefinition;
  rootPath: string;
}

export class PluginRegistry {
  private plugins: LoadedPlugin[] = [];
  private tools = new Map<string, RegisteredPluginTool>();
  private agidExtensions?: AGiDExtensions;

  setAGiDExtensions(extensions: AGiDExtensions): void {
    this.agidExtensions = extensions;
  }

  loadPlugin(input: LoadPluginInput): void {
    const toolCollector: RegisteredPluginTool[] = [];

    try {
      const api = createPluginAPI(
        input.definition.id,
        toolCollector,
        this.agidExtensions,
      );
      input.definition.register(api);
    } catch (error) {
      console.error(`[PluginRegistry] Failed to register plugin '${input.definition.id}':`, error);
      return;
    }

    for (const tool of toolCollector) {
      if (this.tools.has(tool.registration.name)) {
        console.warn(`[PluginRegistry] Tool '${tool.registration.name}' already exists — skipping from plugin '${tool.pluginId}'`);
        continue;
      }
      this.tools.set(tool.registration.name, tool);
    }

    const loadedPlugin: LoadedPlugin = {
      manifest: input.manifest,
      definition: input.definition,
      tools: new Map(toolCollector.map(t => [t.registration.name, t])),
      rootPath: input.rootPath,
    };

    this.plugins.push(loadedPlugin);
  }

  getTool(name: string): RegisteredPluginTool | undefined {
    return this.tools.get(name);
  }

  getTools(): RegisteredPluginTool[] {
    return [...this.tools.values()];
  }

  getPlugins(): LoadedPlugin[] {
    return [...this.plugins];
  }

  async executeTool(
    name: string,
    params: Record<string, unknown>,
    timeoutMs: number = 30_000,
  ): Promise<PluginToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        content: [{ type: 'text', text: `Unknown tool: ${name}` }],
        isError: true,
      };
    }

    const invocationId = randomUUID();

    try {
      const ctx = tool.registration.requiresWallet && this.agidExtensions
        ? { wallet: this.agidExtensions.wallet }
        : undefined;

      const result = await Promise.race([
        tool.registration.execute(invocationId, params, ctx),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Tool '${name}' timed out after ${timeoutMs}ms`)), timeoutMs)
        ),
      ]);

      return result;
    } catch (error) {
      return {
        content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
        isError: true,
      };
    }
  }

  async destroyAll(): Promise<void> {
    for (const plugin of this.plugins) {
      if (plugin.definition.destroy) {
        try {
          await plugin.definition.destroy();
        } catch (error) {
          console.error(`[PluginRegistry] Error destroying plugin '${plugin.definition.id}':`, error);
        }
      }
    }
  }
}
