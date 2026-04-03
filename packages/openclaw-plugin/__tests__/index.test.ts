import { describe, it, expect } from 'vitest';
import openclawPlugin from '../index.js';

describe('@agid/openclaw-plugin', () => {
  it('has correct plugin metadata', () => {
    expect(openclawPlugin.id).toBe('agid');
    expect(openclawPlugin.name).toContain('AGiD');
  });

  it('registers all tools via proxy API', async () => {
    const registeredTools: Array<{ name: string; group?: string }> = [];

    const mockApi = {
      registerTool(tool: any, options?: any) {
        registeredTools.push({ name: tool.name, group: options?.group });
      },
      config: { network: 'testnet' },
    };

    await openclawPlugin.register(mockApi);

    // Should register tools from 6 plugins (identity, crypto, wallet, messaging, memory, audit)
    // audit(2) + messaging(5) + crypto(5) + wallet(7) + memory(4) + identity(18) = 41
    // minus excluded: agid_gc_legacy_tokens = 40
    expect(registeredTools.length).toBeGreaterThanOrEqual(38);

    // Check core AGiD tool names exist
    const names = registeredTools.map(t => t.name);
    expect(names).toContain('agid_verify_workspace');
    expect(names).toContain('agid_sign');
    expect(names).toContain('agid_token_create');
    expect(names).toContain('agid_identity');

    // These should NOT be registered (OpenClaw provides its own)
    expect(names).not.toContain('exec');
    expect(names).not.toContain('read');
    expect(names).not.toContain('browser');
    expect(names).not.toContain('agid_optimize_prompt');
    expect(names).not.toContain('agid_mandala_create_project');
    expect(names).not.toContain('agid_gc_legacy_tokens');
  });

  it('has destroy method', () => {
    expect(typeof openclawPlugin.destroy).toBe('function');
  });
});
