import { describe, it, expect, vi } from 'vitest';
import { createPluginAPI } from '../../plugins/plugin-api.js';
import type { RegisteredPluginTool } from '../../plugins/types.js';

describe('createPluginAPI', () => {
  it('registers a tool and adds to collected tools', () => {
    const tools: RegisteredPluginTool[] = [];
    const api = createPluginAPI('test-plugin', tools);

    api.registerTool({
      name: 'my_tool',
      description: 'A test tool',
      parameters: { type: 'object', properties: {} },
      async execute() {
        return { content: [{ type: 'text', text: 'ok' }] };
      },
    });

    expect(tools).toHaveLength(1);
    expect(tools[0].registration.name).toBe('my_tool');
    expect(tools[0].pluginId).toBe('test-plugin');
  });

  it('accepts optional tool options', () => {
    const tools: RegisteredPluginTool[] = [];
    const api = createPluginAPI('test-plugin', tools);

    api.registerTool(
      {
        name: 'optional_tool',
        description: 'Optional',
        parameters: {},
        async execute() {
          return { content: [{ type: 'text', text: 'ok' }] };
        },
      },
      { optional: true, group: 'custom' },
    );

    expect(tools[0].options.optional).toBe(true);
    expect(tools[0].options.group).toBe('custom');
  });

  it('exposes agid extensions when provided', () => {
    const tools: RegisteredPluginTool[] = [];
    const mockWallet = { sign: vi.fn() };
    const api = createPluginAPI('test-plugin', tools, {
      wallet: mockWallet,
      audit: null,
      identity: null,
    });

    expect(api.agid).toBeDefined();
    expect(api.agid?.wallet).toBe(mockWallet);
  });

  it('agid is undefined when no extensions provided', () => {
    const tools: RegisteredPluginTool[] = [];
    const api = createPluginAPI('test-plugin', tools);

    expect(api.agid).toBeUndefined();
  });

  it('rejects duplicate tool names within same plugin', () => {
    const tools: RegisteredPluginTool[] = [];
    const api = createPluginAPI('test-plugin', tools);

    api.registerTool({
      name: 'dupe',
      description: 'First',
      parameters: {},
      async execute() { return { content: [{ type: 'text', text: 'ok' }] }; },
    });

    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    api.registerTool({
      name: 'dupe',
      description: 'Second',
      parameters: {},
      async execute() { return { content: [{ type: 'text', text: 'ok' }] }; },
    });

    expect(tools).toHaveLength(1);
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
