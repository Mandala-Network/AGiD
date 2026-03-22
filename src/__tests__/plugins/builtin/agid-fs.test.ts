import { describe, it, expect } from 'vitest';
import { PluginRegistry } from '../../../plugins/plugin-registry.js';
import { agidFsPlugin } from '../../../plugins/builtin/agid-fs.js';

describe('agid-fs plugin', () => {
  it('registers 4 tools', () => {
    const registry = new PluginRegistry();
    registry.loadPlugin({
      manifest: { id: 'agid-fs' },
      definition: agidFsPlugin,
      rootPath: '',
    });
    const tools = registry.getTools();
    expect(tools).toHaveLength(4);
    const names = tools.map(t => t.registration.name);
    expect(names).toContain('read');
    expect(names).toContain('write');
    expect(names).toContain('edit');
    expect(names).toContain('apply_patch');
  });

  it('tools are in the fs group', () => {
    const registry = new PluginRegistry();
    registry.loadPlugin({
      manifest: { id: 'agid-fs' },
      definition: agidFsPlugin,
      rootPath: '',
    });
    for (const tool of registry.getTools()) {
      expect(tool.options.group).toBe('fs');
    }
  });

  it('no tool requires wallet', () => {
    const registry = new PluginRegistry();
    registry.loadPlugin({
      manifest: { id: 'agid-fs' },
      definition: agidFsPlugin,
      rootPath: '',
    });
    for (const tool of registry.getTools()) {
      expect(tool.registration.requiresWallet).toBe(false);
    }
  });
});
