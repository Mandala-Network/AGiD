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
      config: {},
    };

    await openclawPlugin.register(mockApi);

    // Should register tools from all 11 builtin plugins
    // audit(2) + optimize(1) + messaging(5) + crypto(5) + wallet(7) + memory(4) + identity(18) + deploy(8) + runtime(2) + fs(4) + browser(1) = 57
    expect(registeredTools.length).toBeGreaterThanOrEqual(50);

    // Check some key tool names exist
    const names = registeredTools.map(t => t.name);
    expect(names).toContain('agid_verify_workspace');
    expect(names).toContain('agid_sign');
    expect(names).toContain('agid_token_create');
    expect(names).toContain('agid_identity');
    expect(names).toContain('exec');
    expect(names).toContain('read');
    expect(names).toContain('browser');
  });

  it('has destroy method', () => {
    expect(typeof openclawPlugin.destroy).toBe('function');
  });
});
