import { describe, it, expect, vi } from 'vitest';
import { PluginRegistry } from '../../plugins/plugin-registry.js';

describe('PluginRegistry', () => {
  it('loads a plugin definition and collects its tools', () => {
    const registry = new PluginRegistry();
    registry.loadPlugin({
      manifest: { id: 'test' },
      definition: {
        id: 'test',
        name: 'Test',
        register(api) {
          api.registerTool({
            name: 'test_tool',
            description: 'A test',
            parameters: {},
            async execute() {
              return { content: [{ type: 'text', text: 'ok' }] };
            },
          });
        },
      },
      rootPath: '/tmp/test',
    });
    expect(registry.getTools()).toHaveLength(1);
    expect(registry.getTool('test_tool')).toBeDefined();
    expect(registry.getPlugins()).toHaveLength(1);
  });

  it('skips duplicate tool names across plugins', () => {
    const registry = new PluginRegistry();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    registry.loadPlugin({
      manifest: { id: 'plugin-a' },
      definition: {
        id: 'plugin-a', name: 'A',
        register(api) {
          api.registerTool({ name: 'shared_tool', description: 'From A', parameters: {},
            async execute() { return { content: [{ type: 'text', text: 'a' }] }; },
          });
        },
      },
      rootPath: '/tmp/a',
    });
    registry.loadPlugin({
      manifest: { id: 'plugin-b' },
      definition: {
        id: 'plugin-b', name: 'B',
        register(api) {
          api.registerTool({ name: 'shared_tool', description: 'From B', parameters: {},
            async execute() { return { content: [{ type: 'text', text: 'b' }] }; },
          });
        },
      },
      rootPath: '/tmp/b',
    });
    expect(registry.getTools()).toHaveLength(1);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('executes a tool and returns result', async () => {
    const registry = new PluginRegistry();
    registry.loadPlugin({
      manifest: { id: 'test' },
      definition: {
        id: 'test', name: 'Test',
        register(api) {
          api.registerTool({ name: 'echo', description: 'Echo', parameters: {},
            async execute(_id, params) {
              return { content: [{ type: 'text', text: `echo: ${params.input}` }] };
            },
          });
        },
      },
      rootPath: '/tmp/test',
    });
    const result = await registry.executeTool('echo', { input: 'hello' });
    expect(result.content[0].text).toBe('echo: hello');
  });

  it('returns error for unknown tool', async () => {
    const registry = new PluginRegistry();
    const result = await registry.executeTool('nonexistent', {});
    expect(result.isError).toBe(true);
  });

  it('catches tool execution errors', async () => {
    const registry = new PluginRegistry();
    registry.loadPlugin({
      manifest: { id: 'test' },
      definition: {
        id: 'test', name: 'Test',
        register(api) {
          api.registerTool({ name: 'broken', description: 'Throws', parameters: {},
            async execute() { throw new Error('boom'); },
          });
        },
      },
      rootPath: '/tmp/test',
    });
    const result = await registry.executeTool('broken', {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('boom');
  });

  it('calls destroy on all plugins during shutdown', async () => {
    const registry = new PluginRegistry();
    const destroyFn = vi.fn();
    registry.loadPlugin({
      manifest: { id: 'test' },
      definition: { id: 'test', name: 'Test', register(_api) {}, destroy: destroyFn },
      rootPath: '/tmp/test',
    });
    await registry.destroyAll();
    expect(destroyFn).toHaveBeenCalled();
  });

  it('continues shutdown even if destroy throws', async () => {
    const registry = new PluginRegistry();
    const secondDestroy = vi.fn();
    registry.loadPlugin({
      manifest: { id: 'first' },
      definition: {
        id: 'first', name: 'First', register(_api) {},
        async destroy() { throw new Error('cleanup failed'); },
      },
      rootPath: '/tmp/first',
    });
    registry.loadPlugin({
      manifest: { id: 'second' },
      definition: { id: 'second', name: 'Second', register(_api) {}, destroy: secondDestroy },
      rootPath: '/tmp/second',
    });
    await registry.destroyAll();
    expect(secondDestroy).toHaveBeenCalled();
  });
});
