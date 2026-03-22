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
    expect(tools).toHaveLength(4);
    const names = tools.map(t => t.registration.name);
    expect(names).toContain('agid_store_memory');
    expect(names).toContain('agid_recall_memories');
    expect(names).toContain('shad_deep_recall');
    expect(names).toContain('shad_search_memories');
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

  it('agid_store_memory requires wallet', () => {
    const registry = new PluginRegistry();
    registry.loadPlugin({
      manifest: { id: 'agid-memory' },
      definition: agidMemoryPlugin,
      rootPath: '',
    });
    const tools = registry.getTools();
    const storeTool = tools.find(t => t.registration.name === 'agid_store_memory');
    expect(storeTool!.registration.requiresWallet).toBe(true);
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
