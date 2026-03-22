import { describe, it, expect } from 'vitest';
import { PluginRegistry } from '../../../plugins/plugin-registry.js';
import { agidCryptoPlugin } from '../../../plugins/builtin/agid-crypto.js';

describe('agid-crypto plugin', () => {
  it('registers 5 tools', () => {
    const registry = new PluginRegistry();
    registry.loadPlugin({
      manifest: { id: 'agid-crypto' },
      definition: agidCryptoPlugin,
      rootPath: '',
    });
    const tools = registry.getTools();
    expect(tools).toHaveLength(5);
    const names = tools.map(t => t.registration.name);
    expect(names).toContain('agid_sign');
    expect(names).toContain('agid_encrypt');
    expect(names).toContain('agid_decrypt');
    expect(names).toContain('agid_wallet_client_request');
    expect(names).toContain('agid_request_user_signature');
  });

  it('tools are in the crypto group', () => {
    const registry = new PluginRegistry();
    registry.loadPlugin({
      manifest: { id: 'agid-crypto' },
      definition: agidCryptoPlugin,
      rootPath: '',
    });
    for (const tool of registry.getTools()) {
      expect(tool.options.group).toBe('crypto');
    }
  });

  it('sign, encrypt, decrypt require wallet', () => {
    const registry = new PluginRegistry();
    registry.loadPlugin({
      manifest: { id: 'agid-crypto' },
      definition: agidCryptoPlugin,
      rootPath: '',
    });
    const tools = registry.getTools();
    const walletRequired = ['agid_sign', 'agid_encrypt', 'agid_decrypt'];
    for (const name of walletRequired) {
      const tool = tools.find(t => t.registration.name === name);
      expect(tool?.registration.requiresWallet).toBe(true);
    }
  });

  it('wallet_client_request and request_user_signature do not require wallet', () => {
    const registry = new PluginRegistry();
    registry.loadPlugin({
      manifest: { id: 'agid-crypto' },
      definition: agidCryptoPlugin,
      rootPath: '',
    });
    const tools = registry.getTools();
    const noWallet = ['agid_wallet_client_request', 'agid_request_user_signature'];
    for (const name of noWallet) {
      const tool = tools.find(t => t.registration.name === name);
      expect(tool?.registration.requiresWallet).toBe(false);
    }
  });
});
