import { describe, it, expect } from 'vitest';
import { PluginRegistry } from '../../../plugins/plugin-registry.js';
import { agidOptimizePlugin } from '../../../plugins/builtin/agid-optimize.js';

describe('agid-optimize plugin', () => {
  it('registers 1 tool', () => {
    const registry = new PluginRegistry();
    registry.loadPlugin({
      manifest: { id: 'agid-optimize' },
      definition: agidOptimizePlugin,
      rootPath: '',
    });
    const tools = registry.getTools();
    expect(tools).toHaveLength(1);
    expect(tools[0].registration.name).toBe('agid_optimize_prompt');
  });

  it('has correct required parameters', () => {
    const registry = new PluginRegistry();
    registry.loadPlugin({
      manifest: { id: 'agid-optimize' },
      definition: agidOptimizePlugin,
      rootPath: '',
    });
    const params = registry.getTools()[0].registration.parameters as any;
    expect(params.required).toContain('text');
    expect(params.required).toContain('objective');
  });
});
