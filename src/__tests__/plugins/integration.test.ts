import { describe, it, expect } from 'vitest';
import { definePluginEntry } from '../../plugins/define-plugin-entry.js';
import { PluginRegistry } from '../../plugins/plugin-registry.js';
import { ToolAccessControl } from '../../plugins/tool-access.js';
import { adaptNewResult } from '../../plugins/result-adapter.js';

describe('plugin system integration', () => {
  it('full lifecycle: define → register → access control → execute → destroy', async () => {
    let destroyed = false;

    // 1. Define a plugin
    const plugin = definePluginEntry({
      id: 'integration-test',
      name: 'Integration Test Plugin',
      register(api) {
        api.registerTool({
          name: 'greet',
          description: 'Greet someone',
          parameters: { type: 'object', properties: { name: { type: 'string' } } },
          async execute(_id, params) {
            return { content: [{ type: 'text', text: `Hello, ${params.name}!` }] };
          },
        });

        api.registerTool(
          {
            name: 'secret_tool',
            description: 'Optional secret',
            parameters: {},
            async execute() {
              return { content: [{ type: 'text', text: 'secret' }] };
            },
          },
          { optional: true },
        );
      },
      async destroy() {
        destroyed = true;
      },
    });

    // 2. Load into registry
    const registry = new PluginRegistry();
    registry.loadPlugin({
      manifest: { id: 'integration-test' },
      definition: plugin,
      rootPath: '/tmp/test',
    });

    expect(registry.getTools()).toHaveLength(2);

    // 3. Access control
    const ac = new ToolAccessControl({ profile: 'full' });
    const tools = registry.getTools();
    for (const tool of tools) {
      if (tool.options.optional) {
        ac.registerOptionalTool(tool.registration.name);
      }
    }

    expect(ac.isAllowed('greet')).toBe(true);
    expect(ac.isAllowed('secret_tool')).toBe(false);

    // 4. Execute a tool
    const result = await registry.executeTool('greet', { name: 'World' });
    expect(result.content[0].text).toBe('Hello, World!');

    // 5. Convert to old format for legacy consumers
    const oldResult = adaptNewResult(result);
    expect(oldResult.content).toBe('Hello, World!');

    // 6. Destroy
    await registry.destroyAll();
    expect(destroyed).toBe(true);
  });
});
