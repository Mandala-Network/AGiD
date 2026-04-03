import { describe, it, expect } from 'vitest';
import { PluginRegistry } from '../../../plugins/plugin-registry.js';
import { agidAuditPlugin } from '../../../plugins/builtin/agid-audit.js';

describe('agid-audit plugin', () => {
  it('registers 2 tools', () => {
    const registry = new PluginRegistry();
    registry.loadPlugin({
      manifest: { id: 'agid-audit' },
      definition: agidAuditPlugin,
      rootPath: '',
    });
    const tools = registry.getTools();
    expect(tools).toHaveLength(2);
    const names = tools.map(t => t.registration.name);
    expect(names).toContain('agid_verify_workspace');
    expect(names).toContain('agid_verify_session');
  });

  it('tools are in the audit group', () => {
    const registry = new PluginRegistry();
    registry.loadPlugin({
      manifest: { id: 'agid-audit' },
      definition: agidAuditPlugin,
      rootPath: '',
    });
    for (const tool of registry.getTools()) {
      expect(tool.options.group).toBe('audit');
    }
  });
});
