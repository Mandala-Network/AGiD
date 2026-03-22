/**
 * Plugin System
 *
 * Re-exports the public API of the plugin system.
 */

export { definePluginEntry } from './define-plugin-entry.js';
export { PluginRegistry } from './plugin-registry.js';
export { createPluginAPI } from './plugin-api.js';
export { ToolAccessControl } from './tool-access.js';
export { discoverPlugins, readManifest, loadPluginModule } from './plugin-loader.js';
export { discoverSkills, parseSkillFile } from './skills-loader.js';
export { adaptOldResult, adaptNewResult, isOldFormat } from './result-adapter.js';
export type {
  PluginDefinition,
  PluginAPI,
  PluginManifest,
  PluginToolResult,
  ToolRegistration,
  ToolRegistrationOptions,
  RegisteredPluginTool,
  LoadedPlugin,
  AGiDExtensions,
  ToolExecutionContext,
} from './types.js';
export type { Skill } from './skills-loader.js';
