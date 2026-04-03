import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MockAgentWallet } from './mock-wallet.js';

// We must mock wallet-init BEFORE importing the plugin so the proxy's
// getWallet() returns our MockAgentWallet instead of a real BSV wallet.
let currentMockWallet: MockAgentWallet;

vi.mock('../src/wallet-init.js', () => ({
  initWallet: async () => currentMockWallet,
  destroyWallet: async () => {},
}));

// Dynamic import after mock is in place
const { default: openclawPlugin } = await import('../index.js');

/**
 * Helper: register the plugin with a mock API and return registered tools.
 */
async function setupPlugin(mockWallet: MockAgentWallet) {
  const registeredTools = new Map<string, { tool: any; options?: any }>();

  const mockApi = {
    registerTool(tool: any, options?: any) {
      registeredTools.set(tool.name, { tool, options });
    },
    config: { network: 'testnet' },
    prompt: undefined,
  };

  await openclawPlugin.register(mockApi);

  return {
    registeredTools,
    async exec(toolName: string, params: Record<string, unknown> = {}) {
      const entry = registeredTools.get(toolName);
      if (!entry) throw new Error(`Tool "${toolName}" not registered`);
      return entry.tool.execute(toolName, params, {});
    },
    async execJson(toolName: string, params: Record<string, unknown> = {}) {
      const result = await this.exec(toolName, params);
      const text = result.content?.[0]?.text;
      if (!text) throw new Error(`Tool "${toolName}" returned no text content`);
      return JSON.parse(text);
    },
  };
}

describe('OpenClaw Plugin Integration', () => {
  let wallet: MockAgentWallet;
  let plugin: Awaited<ReturnType<typeof setupPlugin>>;

  beforeEach(async () => {
    wallet = new MockAgentWallet('testnet');
    currentMockWallet = wallet;
    plugin = await setupPlugin(wallet);
  });

  describe('wallet context injection', () => {
    it('marks identity tool as requiresWallet', () => {
      const identityTool = plugin.registeredTools.get('agid_identity');
      expect(identityTool).toBeDefined();
      expect(identityTool!.tool.requiresWallet).toBe(true);
    });

    it('marks zkproof_verify as not requiring wallet', () => {
      const verifyTool = plugin.registeredTools.get('agid_zkproof_verify');
      expect(verifyTool).toBeDefined();
      expect(verifyTool!.tool.requiresWallet).toBe(false);
    });
  });

  describe('sign and encrypt round-trip', () => {
    it('signs a message and returns hex signature', async () => {
      const result = await plugin.execJson('agid_sign', { message: 'hello world' });
      expect(result.signed).toBe(true);
      expect(result.signature).toBeDefined();
      expect(typeof result.signature).toBe('string');
      expect(result.signature).toMatch(/^[0-9a-f]+$/i);
    });

    it('encrypts and decrypts data with matching keys', async () => {
      const plaintext = 'secret agent data';
      const encrypted = await plugin.execJson('agid_encrypt', { data: plaintext });
      expect(encrypted.encrypted).toBe(true);
      expect(encrypted.ciphertext).toBeDefined();
      expect(encrypted.ciphertext).not.toBe(plaintext);

      const decrypted = await plugin.execJson('agid_decrypt', { ciphertext: encrypted.ciphertext });
      expect(decrypted.decrypted).toBe(true);
      expect(decrypted.plaintext).toBe(plaintext);
    });
  });

  describe('identity info', () => {
    it('returns public key and network', async () => {
      const result = await plugin.execJson('agid_identity', {});
      expect(result.publicKey).toBeDefined();
      expect(typeof result.publicKey).toBe('string');
      expect(result.publicKey).toMatch(/^0[23][0-9a-f]{64}$/i);
      expect(result.network).toBe('testnet');
    });
  });

  describe('excluded tools', () => {
    const MUST_BE_ABSENT = [
      'exec', 'process', 'read', 'write', 'edit', 'apply_patch', 'browser',
      'agid_optimize_prompt',
      'agid_mandala_create_project', 'agid_mandala_list_projects',
      'agid_mandala_project_info', 'agid_mandala_deploy',
      'agid_mandala_update_settings', 'agid_mandala_project_logs',
      'agid_mandala_manage_admins', 'agid_mandala_node_info',
      'agid_gc_legacy_tokens', 'shad_deep_recall', 'shad_search_memories',
    ];

    for (const toolName of MUST_BE_ABSENT) {
      it(`does not register "${toolName}"`, () => {
        expect(plugin.registeredTools.has(toolName)).toBe(false);
      });
    }
  });
});
