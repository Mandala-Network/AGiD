import { describe, it, expect } from 'vitest';
import { PluginRegistry } from '../../../plugins/plugin-registry.js';
import { agidRuntimePlugin } from '../../../plugins/builtin/agid-runtime.js';

describe('agid-runtime plugin', () => {
  it('registers 2 tools', () => {
    const registry = new PluginRegistry();
    registry.loadPlugin({
      manifest: { id: 'agid-runtime' },
      definition: agidRuntimePlugin,
      rootPath: '',
    });
    const tools = registry.getTools();
    expect(tools).toHaveLength(2);
    const names = tools.map(t => t.registration.name);
    expect(names).toContain('exec');
    expect(names).toContain('process');
  });

  it('tools are in the runtime group', () => {
    const registry = new PluginRegistry();
    registry.loadPlugin({
      manifest: { id: 'agid-runtime' },
      definition: agidRuntimePlugin,
      rootPath: '',
    });
    for (const tool of registry.getTools()) {
      expect(tool.options.group).toBe('runtime');
    }
  });

  it('no tool requires wallet', () => {
    const registry = new PluginRegistry();
    registry.loadPlugin({
      manifest: { id: 'agid-runtime' },
      definition: agidRuntimePlugin,
      rootPath: '',
    });
    for (const tool of registry.getTools()) {
      expect(tool.registration.requiresWallet).toBe(false);
    }
  });
});
