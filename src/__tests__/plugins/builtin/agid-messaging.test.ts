import { describe, it, expect } from 'vitest';
import { PluginRegistry } from '../../../plugins/plugin-registry.js';
import { agidMessagingPlugin } from '../../../plugins/builtin/agid-messaging.js';

describe('agid-messaging plugin', () => {
  it('registers 5 tools', () => {
    const registry = new PluginRegistry();
    registry.loadPlugin({
      manifest: { id: 'agid-messaging' },
      definition: agidMessagingPlugin,
      rootPath: '',
    });
    const tools = registry.getTools();
    expect(tools).toHaveLength(5);
    const names = tools.map(t => t.registration.name);
    expect(names).toContain('agid_message_send');
    expect(names).toContain('agid_message_list');
    expect(names).toContain('agid_message_ack');
    expect(names).toContain('agid_list_payments');
    expect(names).toContain('agid_accept_payment');
  });

  it('tools are in the messaging group', () => {
    const registry = new PluginRegistry();
    registry.loadPlugin({
      manifest: { id: 'agid-messaging' },
      definition: agidMessagingPlugin,
      rootPath: '',
    });
    for (const tool of registry.getTools()) {
      expect(tool.options.group).toBe('messaging');
    }
  });

  it('all tools require wallet', () => {
    const registry = new PluginRegistry();
    registry.loadPlugin({
      manifest: { id: 'agid-messaging' },
      definition: agidMessagingPlugin,
      rootPath: '',
    });
    for (const tool of registry.getTools()) {
      expect(tool.registration.requiresWallet).toBe(true);
    }
  });
});
