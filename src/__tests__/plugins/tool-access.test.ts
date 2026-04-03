import { describe, it, expect } from 'vitest';
import { ToolAccessControl } from '../../plugins/tool-access.js';

describe('ToolAccessControl', () => {
  it('allows all tools with full profile', () => {
    const ac = new ToolAccessControl({ profile: 'full' });
    expect(ac.isAllowed('exec')).toBe(true);
    expect(ac.isAllowed('anything')).toBe(true);
  });

  it('allows only minimal tools with minimal profile', () => {
    const ac = new ToolAccessControl({ profile: 'minimal' });
    expect(ac.isAllowed('exec')).toBe(false);
    expect(ac.isAllowed('session_status')).toBe(true);
  });

  it('deny always wins over allow', () => {
    const ac = new ToolAccessControl({ profile: 'full', deny: ['exec'] });
    expect(ac.isAllowed('exec')).toBe(false);
  });

  it('allow adds tools on top of profile', () => {
    const ac = new ToolAccessControl({ profile: 'minimal', allow: ['custom_tool'] });
    expect(ac.isAllowed('custom_tool')).toBe(true);
    expect(ac.isAllowed('exec')).toBe(false);
  });

  it('allows tool groups via group: prefix', () => {
    const ac = new ToolAccessControl({ profile: 'minimal', allow: ['group:runtime'] });
    ac.registerToolGroup('runtime', ['exec', 'process']);
    expect(ac.isAllowed('exec')).toBe(true);
    expect(ac.isAllowed('process')).toBe(true);
    expect(ac.isAllowed('browser')).toBe(false);
  });

  it('handles optional tools (not allowed unless in allow list)', () => {
    const ac = new ToolAccessControl({ profile: 'full' });
    ac.registerOptionalTool('optional_tool');
    expect(ac.isAllowed('optional_tool')).toBe(false);

    const ac2 = new ToolAccessControl({ profile: 'full', allow: ['optional_tool'] });
    ac2.registerOptionalTool('optional_tool');
    expect(ac2.isAllowed('optional_tool')).toBe(true);
  });
});
