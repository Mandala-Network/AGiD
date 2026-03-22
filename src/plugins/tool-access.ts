/**
 * Tool Access Control
 *
 * Profiles, allow/deny lists, and group-based access control
 * matching OpenClaw's tools.allow/tools.deny system.
 */

export interface ToolAccessConfig {
  profile?: 'full' | 'coding' | 'minimal';
  allow?: string[];
  deny?: string[];
}

const MINIMAL_TOOLS = new Set(['session_status']);

const CODING_TOOLS = new Set([
  'session_status',
  'read', 'write', 'edit', 'apply_patch',
  'exec', 'process',
  'image',
]);

export class ToolAccessControl {
  private profile: 'full' | 'coding' | 'minimal';
  private allow: Set<string>;
  private deny: Set<string>;
  private groups = new Map<string, Set<string>>();
  private optionalTools = new Set<string>();

  constructor(config: ToolAccessConfig) {
    this.profile = config.profile ?? 'full';
    this.deny = new Set(config.deny ?? []);
    this.allow = new Set<string>(config.allow ?? []);
  }

  registerToolGroup(name: string, tools: string[]): void {
    this.groups.set(name, new Set(tools));
  }

  registerOptionalTool(name: string): void {
    this.optionalTools.add(name);
  }

  isAllowed(toolName: string): boolean {
    if (this.deny.has(toolName)) return false;
    if (this.optionalTools.has(toolName)) {
      return this.isExplicitlyAllowed(toolName);
    }
    if (this.isExplicitlyAllowed(toolName)) return true;
    switch (this.profile) {
      case 'full': return true;
      case 'coding': return CODING_TOOLS.has(toolName);
      case 'minimal': return MINIMAL_TOOLS.has(toolName);
    }
  }

  private isExplicitlyAllowed(toolName: string): boolean {
    if (this.allow.has(toolName)) return true;
    for (const entry of this.allow) {
      if (entry.startsWith('group:')) {
        const groupName = entry.slice(6);
        const groupTools = this.groups.get(groupName);
        if (groupTools?.has(toolName)) return true;
      }
    }
    return false;
  }
}
