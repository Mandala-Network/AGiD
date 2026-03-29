import { describe, it, expect } from 'vitest';
import { PluginRegistry } from '../../../plugins/plugin-registry.js';
import { agidMemoryPlugin } from '../../../plugins/builtin/agid-memory.js';

describe('agid-memory plugin', () => {
  it('registers 4 tools', () => {
    const registry = new PluginRegistry();
    registry.loadPlugin({
      manifest: { id: 'agid-memory' },
      definition: agidMemoryPlugin,
      rootPath: '',
    });
    const tools = registry.getTools();
    expect(tools).toHaveLength(5);
    const names = tools.map(t => t.registration.name);
    expect(names).toContain('agid_store_memory');
    expect(names).toContain('agid_recall_memories');
    expect(names).toContain('shad_deep_recall');
    expect(names).toContain('shad_search_memories');
    expect(names).toContain('agid_gc_legacy_tokens');
  });

  it('tools are in the memory group', () => {
    const registry = new PluginRegistry();
    registry.loadPlugin({
      manifest: { id: 'agid-memory' },
      definition: agidMemoryPlugin,
      rootPath: '',
    });
    for (const tool of registry.getTools()) {
      expect(tool.options.group).toBe('memory');
    }
  });

  it('agid_store_memory and agid_gc_legacy_tokens require wallet', () => {
    const registry = new PluginRegistry();
    registry.loadPlugin({
      manifest: { id: 'agid-memory' },
      definition: agidMemoryPlugin,
      rootPath: '',
    });
    const tools = registry.getTools();
    for (const name of ['agid_store_memory', 'agid_gc_legacy_tokens']) {
      const tool = tools.find(t => t.registration.name === name);
      expect(tool!.registration.requiresWallet, `${name} should require wallet`).toBe(true);
    }
  });

  it('recall and shad tools do NOT require wallet', () => {
    const registry = new PluginRegistry();
    registry.loadPlugin({
      manifest: { id: 'agid-memory' },
      definition: agidMemoryPlugin,
      rootPath: '',
    });
    const tools = registry.getTools();
    const noWalletTools = ['agid_recall_memories', 'shad_deep_recall', 'shad_search_memories'];
    for (const name of noWalletTools) {
      const tool = tools.find(t => t.registration.name === name);
      expect(tool!.registration.requiresWallet).toBeFalsy();
    }
  });
});
