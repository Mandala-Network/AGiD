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

  it('create_action, internalize_action, send_payment, token_create, token_redeem require wallet', () => {
    const registry = new PluginRegistry();
    registry.loadPlugin({
      manifest: { id: 'agid-wallet' },
      definition: agidWalletPlugin,
      rootPath: '',
    });
    const tools = registry.getTools();
    const walletRequired = [
      'agid_create_action',
      'agid_internalize_action',
      'agid_send_payment',
      'agid_token_create',
      'agid_token_redeem',
    ];
    for (const name of walletRequired) {
      const tool = tools.find(t => t.registration.name === name);
      expect(tool?.registration.requiresWallet).toBe(true);
    }
  });

  it('list_outputs and token_list do not require wallet', () => {
    const registry = new PluginRegistry();
    registry.loadPlugin({
      manifest: { id: 'agid-wallet' },
      definition: agidWalletPlugin,
      rootPath: '',
    });
    const tools = registry.getTools();
    const noWallet = ['agid_list_outputs', 'agid_token_list'];
    for (const name of noWallet) {
      const tool = tools.find(t => t.registration.name === name);
      expect(tool?.registration.requiresWallet).toBe(false);
    }
  });
});
