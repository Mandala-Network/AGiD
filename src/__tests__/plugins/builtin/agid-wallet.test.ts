import { describe, it, expect } from 'vitest';
import { PluginRegistry } from '../../../plugins/plugin-registry.js';
import { agidWalletPlugin } from '../../../plugins/builtin/agid-wallet.js';

describe('agid-wallet plugin', () => {
  it('registers 7 tools', () => {
    const registry = new PluginRegistry();
    registry.loadPlugin({
      manifest: { id: 'agid-wallet' },
      definition: agidWalletPlugin,
      rootPath: '',
    });
    const tools = registry.getTools();
    expect(tools).toHaveLength(7);
    const names = tools.map(t => t.registration.name);
    expect(names).toContain('agid_create_action');
    expect(names).toContain('agid_internalize_action');
    expect(names).toContain('agid_list_outputs');
    expect(names).toContain('agid_send_payment');
    expect(names).toContain('agid_token_create');
    expect(names).toContain('agid_token_list');
    expect(names).toContain('agid_token_redeem');
  });

  it('tools are in the wallet group', () => {
    const registry = new PluginRegistry();
    registry.loadPlugin({
      manifest: { id: 'agid-wallet' },
      definition: agidWalletPlugin,
      rootPath: '',
    });
    for (const tool of registry.getTools()) {
      expect(tool.options.group).toBe('wallet');
    }
  });

  it('all wallet tools require wallet', () => {
    const registry = new PluginRegistry();
    registry.loadPlugin({
      manifest: { id: 'agid-wallet' },
      definition: agidWalletPlugin,
      rootPath: '',
    });
    const tools = registry.getTools();
    for (const tool of tools) {
      expect(tool.registration.requiresWallet, `${tool.registration.name} should require wallet`).toBe(true);
    }
  });
});
