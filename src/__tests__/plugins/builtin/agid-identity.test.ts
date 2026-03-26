import { describe, it, expect } from 'vitest';
import { PluginRegistry } from '../../../plugins/plugin-registry.js';
import { agidIdentityPlugin } from '../../../plugins/builtin/agid-identity.js';

describe('agid-identity plugin', () => {
  it('registers 18 tools', () => {
    const registry = new PluginRegistry();
    registry.loadPlugin({
      manifest: { id: 'agid-identity' },
      definition: agidIdentityPlugin,
      rootPath: '',
    });
    const tools = registry.getTools();
    expect(tools).toHaveLength(18);
  });

  it('tools are in the identity group', () => {
    const registry = new PluginRegistry();
    registry.loadPlugin({
      manifest: { id: 'agid-identity' },
      definition: agidIdentityPlugin,
      rootPath: '',
    });
    for (const tool of registry.getTools()) {
      expect(tool.options.group).toBe('identity');
    }
  });

  it('wallet-requiring tools are marked correctly', () => {
    const registry = new PluginRegistry();
    registry.loadPlugin({
      manifest: { id: 'agid-identity' },
      definition: agidIdentityPlugin,
      rootPath: '',
    });
    const tools = registry.getTools();

    const walletRequired = [
      'agid_identity',
      'agid_balance',
      'agid_get_public_key',
      'agid_get_height',
      'agid_lookup_identity',
      'agid_cert_list',
      'agid_cert_verify',
      'agid_cert_check_revocation',
      'agid_cert_issue',
      'agid_cert_receive',
      'agid_cert_revoke',
      'agid_cert_reveal',
      'agid_cert_send',
      'agid_zkproof_privilege',
      'agid_zkproof_selective_reveal',
      'agid_zkproof_commitment',
      'agid_zkproof_verify_commitment',
    ];

    for (const name of walletRequired) {
      const tool = tools.find(t => t.registration.name === name);
      expect(tool, `${name} should exist`).toBeDefined();
      expect(tool!.registration.requiresWallet, `${name} should require wallet`).toBe(true);
    }
  });

  it('non-wallet tools are marked correctly', () => {
    const registry = new PluginRegistry();
    registry.loadPlugin({
      manifest: { id: 'agid-identity' },
      definition: agidIdentityPlugin,
      rootPath: '',
    });
    const tools = registry.getTools();

    const noWallet = [
      'agid_zkproof_verify',
    ];

    for (const name of noWallet) {
      const tool = tools.find(t => t.registration.name === name);
      expect(tool, `${name} should exist`).toBeDefined();
      expect(tool!.registration.requiresWallet, `${name} should NOT require wallet`).toBeFalsy();
    }
  });
});
