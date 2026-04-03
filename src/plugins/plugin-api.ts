/**
 * Plugin API
 *
 * Creates the `api` object passed to plugin `register()` calls.
 * Collects tool registrations and provides AGiD extensions.
 */

import type {
  PluginAPI,
  AGiDExtensions,
  ToolRegistration,
  ToolRegistrationOptions,
  RegisteredPluginTool,
} from './types.js';

export function createPluginAPI(
  pluginId: string,
  toolCollector: RegisteredPluginTool[],
  agidExtensions?: AGiDExtensions | null,
  config?: Record<string, any>,
): PluginAPI {
  const registeredNames = new Set<string>();

  const api: PluginAPI = {
    registerTool(tool: ToolRegistration, options?: ToolRegistrationOptions): void {
      if (registeredNames.has(tool.name)) {
        console.warn(`[PluginAPI] Tool '${tool.name}' already registered by plugin '${pluginId}' — skipping duplicate`);
        return;
      }

      registeredNames.add(tool.name);
      toolCollector.push({
        registration: tool,
        options: options ?? {},
        pluginId,
      });
    },
    config,
    agid: agidExtensions ?? undefined,
  };

  return api;
}
