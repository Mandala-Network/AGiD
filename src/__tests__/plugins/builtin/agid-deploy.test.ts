import { describe, it, expect } from 'vitest';
import { PluginRegistry } from '../../../plugins/plugin-registry.js';
import { agidDeployPlugin } from '../../../plugins/builtin/agid-deploy.js';

describe('agid-deploy plugin', () => {
  it('registers 8 tools', () => {
    const registry = new PluginRegistry();
    registry.loadPlugin({
      manifest: { id: 'agid-deploy' },
      definition: agidDeployPlugin,
      rootPath: '',
    });
    const tools = registry.getTools();
    expect(tools).toHaveLength(8);
  });

  it('tools are in the deploy group', () => {
    const registry = new PluginRegistry();
    registry.loadPlugin({
      manifest: { id: 'agid-deploy' },
      definition: agidDeployPlugin,
      rootPath: '',
    });
    for (const tool of registry.getTools()) {
      expect(tool.options.group).toBe('deploy');
    }
  });

  it('all tools require wallet except agid_mandala_node_info', () => {
    const registry = new PluginRegistry();
    registry.loadPlugin({
      manifest: { id: 'agid-deploy' },
      definition: agidDeployPlugin,
      rootPath: '',
    });
    const tools = registry.getTools();

    for (const tool of tools) {
      if (tool.registration.name === 'agid_mandala_node_info') {
        expect(tool.registration.requiresWallet, 'agid_mandala_node_info should NOT require wallet').toBeFalsy();
      } else {
        expect(tool.registration.requiresWallet, `${tool.registration.name} should require wallet`).toBe(true);
      }
    }
  });
});
