/**
 * Tool Index
 *
 * Creates all tool descriptors for the AGIdentity agent.
 */

export type { ToolDescriptor, ToolContext, ToolPlugin, ToolCategory } from './types.js';
export { ok } from './types.js';
export { corePlugin } from './core-plugin.js';

import type { ToolDescriptor, ToolContext } from './types.js';

export function createAllTools(_ctx: ToolContext): ToolDescriptor[] {
  // All tools have been migrated to the plugin system.
  // See src/plugins/builtin/ for plugin definitions.
  // Use PluginRegistry.loadPlugin() to register tools.
  return [];
}
