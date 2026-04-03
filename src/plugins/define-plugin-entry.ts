/**
 * definePluginEntry
 *
 * Identity function that provides type safety for plugin definitions.
 * Matches OpenClaw's definePluginEntry pattern.
 */

import type { PluginDefinition } from './types.js';

export function definePluginEntry(definition: PluginDefinition): PluginDefinition {
  return definition;
}
