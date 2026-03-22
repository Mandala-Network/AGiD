import { describe, it, expect } from 'vitest';
import { PluginRegistry } from '../../../plugins/plugin-registry.js';
import { agidBrowserPlugin } from '../../../plugins/builtin/agid-browser.js';

describe('agid-browser plugin', () => {
  it('registers 1 tool', () => {
    const registry = new PluginRegistry();
    registry.loadPlugin({
      manifest: { id: 'agid-browser' },
      definition: agidBrowserPlugin,
      rootPath: '',
    });
    const tools = registry.getTools();
    expect(tools).toHaveLength(1);
    expect(tools[0].registration.name).toBe('browser');
  });

  it('tool is in the browser group', () => {
    const registry = new PluginRegistry();
    registry.loadPlugin({
      manifest: { id: 'agid-browser' },
      definition: agidBrowserPlugin,
      rootPath: '',
    });
    for (const tool of registry.getTools()) {
      expect(tool.options.group).toBe('browser');
    }
  });

  it('tool does not require wallet', () => {
    const registry = new PluginRegistry();
    registry.loadPlugin({
      manifest: { id: 'agid-browser' },
      definition: agidBrowserPlugin,
      rootPath: '',
    });
    for (const tool of registry.getTools()) {
      expect(tool.registration.requiresWallet).toBe(false);
    }
  });
});
