# Plugin Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build AGiD's plugin runtime — the OpenClaw-compatible foundation that discovers, loads, and manages plugins with tool registration, access control, skills loading, and lifecycle management.

**Architecture:** The plugin runtime sits between the gateway and the agent loop. It discovers plugins from configured directories, reads manifests (`agid.plugin.json` or `openclaw.plugin.json`), calls `register(api)` on each plugin, and maintains a central tool registry. The existing `ToolRegistry` is extended to accept tools from both the old `ToolDescriptor` format and the new plugin `registerTool()` format, with an adapter layer for result format conversion. Skills are loaded from `SKILL.md` files with YAML frontmatter.

**Tech Stack:** TypeScript, @sinclair/typebox (parameter schemas), vitest, yaml (frontmatter parsing), chokidar (file watching for skills)

**Spec:** `docs/superpowers/specs/2026-03-21-plugin-architecture-design.md`

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `src/plugins/types.ts` | Plugin system type definitions (PluginDefinition, PluginAPI, ToolRegistration, ToolResult) |
| Create | `src/plugins/define-plugin-entry.ts` | `definePluginEntry()` helper (OpenClaw-compatible) |
| Create | `src/plugins/plugin-api.ts` | The `api` object passed to `register()` — tool registration, AGiD extensions |
| Create | `src/plugins/plugin-loader.ts` | Discovers plugins from dirs, reads manifests, loads modules, calls register() |
| Create | `src/plugins/plugin-registry.ts` | Central registry of loaded plugins and their tools |
| Create | `src/plugins/result-adapter.ts` | Converts old `{ content: string }` to new `{ content: [{ type, text }] }` format |
| Create | `src/plugins/tool-access.ts` | Tool access control (profiles, allow/deny, groups) |
| Create | `src/plugins/skills-loader.ts` | Loads SKILL.md files with YAML frontmatter, precedence, optional watch |
| Create | `src/plugins/config.ts` | Loads `~/.agid/agid.json` (JSON5), merges with env vars — **deferred to gateway integration** |
| Modify | `src/agent/tool-registry.ts` | Add `registerPluginTool()` method that accepts new format, adapter integration |
| Modify | `src/agent/agent-loop.ts` | Use plugin-aware tool dispatch (check access control) |
| Create | `src/__tests__/plugins/define-plugin-entry.test.ts` | Tests for definePluginEntry |
| Create | `src/__tests__/plugins/plugin-api.test.ts` | Tests for the api object and registerTool |
| Create | `src/__tests__/plugins/plugin-loader.test.ts` | Tests for manifest discovery and loading |
| Create | `src/__tests__/plugins/plugin-registry.test.ts` | Tests for central registry |
| Create | `src/__tests__/plugins/result-adapter.test.ts` | Tests for result format conversion |
| Create | `src/__tests__/plugins/tool-access.test.ts` | Tests for access control profiles/groups |
| Create | `src/__tests__/plugins/skills-loader.test.ts` | Tests for SKILL.md loading |
| Create | `src/__tests__/plugins/config.test.ts` | Tests for config loading |

---

### Task 1: Plugin Type Definitions

**Files:**
- Create: `src/plugins/types.ts`
- Create: `src/__tests__/plugins/define-plugin-entry.test.ts`
- Create: `src/plugins/define-plugin-entry.ts`

- [ ] **Step 1: Write failing test for definePluginEntry**

Create `src/__tests__/plugins/define-plugin-entry.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { definePluginEntry } from '../../plugins/define-plugin-entry.js';

describe('definePluginEntry', () => {
  it('returns the plugin definition unchanged', () => {
    const def = definePluginEntry({
      id: 'test-plugin',
      name: 'Test Plugin',
      register(_api) {},
    });
    expect(def.id).toBe('test-plugin');
    expect(def.name).toBe('Test Plugin');
    expect(typeof def.register).toBe('function');
  });

  it('supports optional destroy hook', () => {
    const def = definePluginEntry({
      id: 'test-plugin',
      name: 'Test Plugin',
      register(_api) {},
      async destroy() {},
    });
    expect(typeof def.destroy).toBe('function');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/plugins/define-plugin-entry.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Create plugin types**

Create `src/plugins/types.ts`:

```typescript
/**
 * Plugin System Types
 *
 * OpenClaw-compatible plugin definitions with AGiD extensions.
 */

// ---------------------------------------------------------------------------
// Tool Result (OpenClaw-compatible)
// ---------------------------------------------------------------------------

export interface PluginToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

// ---------------------------------------------------------------------------
// Tool Registration
// ---------------------------------------------------------------------------

export interface ToolRegistration {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // TypeBox or JSON Schema
  requiresWallet?: boolean;
  auditable?: boolean;
  execute(id: string, params: any, ctx?: ToolExecutionContext): Promise<PluginToolResult>;
}

export interface ToolRegistrationOptions {
  optional?: boolean;
  group?: string;
}

export interface ToolExecutionContext {
  wallet?: any; // AgentWallet — injected when requiresWallet is true
  audit?: any;  // AuditLogger — injected when auditable is true
}

// ---------------------------------------------------------------------------
// Plugin API (passed to register())
// ---------------------------------------------------------------------------

export interface PluginAPI {
  registerTool(tool: ToolRegistration, options?: ToolRegistrationOptions): void;
  config?: Record<string, any>;
  agid?: AGiDExtensions;
}

export interface AGiDExtensions {
  wallet: any;   // AgentWallet
  audit: any;    // AuditLogger
  identity: any; // Identity service
}

// ---------------------------------------------------------------------------
// Plugin Definition
// ---------------------------------------------------------------------------

export interface PluginDefinition {
  id: string;
  name: string;
  register(api: PluginAPI): void;
  destroy?(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Plugin Manifest (agid.plugin.json / openclaw.plugin.json)
// ---------------------------------------------------------------------------

export interface PluginManifest {
  id: string;
  name?: string;
  description?: string;
  kind?: string;
  configSchema?: Record<string, unknown>;
  skills?: string[];
}

// ---------------------------------------------------------------------------
// Loaded Plugin (runtime state)
// ---------------------------------------------------------------------------

export interface LoadedPlugin {
  manifest: PluginManifest;
  definition: PluginDefinition;
  tools: Map<string, RegisteredPluginTool>;
  rootPath: string;
}

export interface RegisteredPluginTool {
  registration: ToolRegistration;
  options: ToolRegistrationOptions;
  pluginId: string;
}
```

- [ ] **Step 4: Create definePluginEntry**

Create `src/plugins/define-plugin-entry.ts`:

```typescript
/**
 * definePluginEntry
 *
 * Identity function that provides type safety for plugin definitions.
 * Matches OpenClaw's definePluginEntry pattern.
 */

import type { PluginDefinition } from './types.js';

export function definePluginEntry(definition: PluginDefinition): PluginDefinition {
  return definition;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/__tests__/plugins/define-plugin-entry.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/plugins/types.ts src/plugins/define-plugin-entry.ts src/__tests__/plugins/define-plugin-entry.test.ts
git commit -m "feat: add plugin type definitions and definePluginEntry helper"
```

---

### Task 2: Result Adapter

**Files:**
- Create: `src/plugins/result-adapter.ts`
- Create: `src/__tests__/plugins/result-adapter.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/__tests__/plugins/result-adapter.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  adaptOldResult,
  adaptNewResult,
  isOldFormat,
} from '../../plugins/result-adapter.js';

describe('result-adapter', () => {
  it('converts old format { content: string } to new format', () => {
    const old = { content: '{"key":"value"}' };
    const result = adaptOldResult(old);
    expect(result.content).toEqual([{ type: 'text', text: '{"key":"value"}' }]);
    expect(result.isError).toBeUndefined();
  });

  it('preserves isError flag in conversion', () => {
    const old = { content: 'error message', isError: true };
    const result = adaptOldResult(old);
    expect(result.content).toEqual([{ type: 'text', text: 'error message' }]);
    expect(result.isError).toBe(true);
  });

  it('converts new format back to old format for legacy consumers', () => {
    const newResult = { content: [{ type: 'text' as const, text: 'hello' }] };
    const old = adaptNewResult(newResult);
    expect(old.content).toBe('hello');
  });

  it('concatenates multiple content blocks when converting to old', () => {
    const newResult = {
      content: [
        { type: 'text' as const, text: 'line1' },
        { type: 'text' as const, text: 'line2' },
      ],
    };
    const old = adaptNewResult(newResult);
    expect(old.content).toBe('line1\nline2');
  });

  it('detects old format correctly', () => {
    expect(isOldFormat({ content: 'string' })).toBe(true);
    expect(isOldFormat({ content: [{ type: 'text', text: 'x' }] })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/plugins/result-adapter.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement result-adapter.ts**

Create `src/plugins/result-adapter.ts`:

```typescript
/**
 * Result Adapter
 *
 * Converts between AGiD's old ToolResult format ({ content: string })
 * and the new OpenClaw-compatible format ({ content: [{ type, text }] }).
 */

import type { PluginToolResult } from './types.js';

interface OldToolResult {
  content: string;
  isError?: boolean;
}

export function isOldFormat(result: any): result is OldToolResult {
  return typeof result?.content === 'string';
}

export function adaptOldResult(old: OldToolResult): PluginToolResult {
  return {
    content: [{ type: 'text', text: old.content }],
    isError: old.isError,
  };
}

export function adaptNewResult(newResult: PluginToolResult): OldToolResult {
  const text = newResult.content
    .map(block => block.text)
    .join('\n');
  return {
    content: text,
    isError: newResult.isError,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/plugins/result-adapter.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/plugins/result-adapter.ts src/__tests__/plugins/result-adapter.test.ts
git commit -m "feat: add result adapter for old/new ToolResult format conversion"
```

---

### Task 3: Plugin API (registerTool)

**Files:**
- Create: `src/plugins/plugin-api.ts`
- Create: `src/__tests__/plugins/plugin-api.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/__tests__/plugins/plugin-api.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { createPluginAPI } from '../../plugins/plugin-api.js';
import type { RegisteredPluginTool } from '../../plugins/types.js';

describe('createPluginAPI', () => {
  it('registers a tool and adds to collected tools', () => {
    const tools: RegisteredPluginTool[] = [];
    const api = createPluginAPI('test-plugin', tools);

    api.registerTool({
      name: 'my_tool',
      description: 'A test tool',
      parameters: { type: 'object', properties: {} },
      async execute() {
        return { content: [{ type: 'text', text: 'ok' }] };
      },
    });

    expect(tools).toHaveLength(1);
    expect(tools[0].registration.name).toBe('my_tool');
    expect(tools[0].pluginId).toBe('test-plugin');
  });

  it('accepts optional tool options', () => {
    const tools: RegisteredPluginTool[] = [];
    const api = createPluginAPI('test-plugin', tools);

    api.registerTool(
      {
        name: 'optional_tool',
        description: 'Optional',
        parameters: {},
        async execute() {
          return { content: [{ type: 'text', text: 'ok' }] };
        },
      },
      { optional: true, group: 'custom' },
    );

    expect(tools[0].options.optional).toBe(true);
    expect(tools[0].options.group).toBe('custom');
  });

  it('exposes agid extensions when provided', () => {
    const tools: RegisteredPluginTool[] = [];
    const mockWallet = { sign: vi.fn() };
    const api = createPluginAPI('test-plugin', tools, {
      wallet: mockWallet,
      audit: null,
      identity: null,
    });

    expect(api.agid).toBeDefined();
    expect(api.agid?.wallet).toBe(mockWallet);
  });

  it('agid is undefined when no extensions provided', () => {
    const tools: RegisteredPluginTool[] = [];
    const api = createPluginAPI('test-plugin', tools);

    expect(api.agid).toBeUndefined();
  });

  it('rejects duplicate tool names within same plugin', () => {
    const tools: RegisteredPluginTool[] = [];
    const api = createPluginAPI('test-plugin', tools);

    api.registerTool({
      name: 'dupe',
      description: 'First',
      parameters: {},
      async execute() { return { content: [{ type: 'text', text: 'ok' }] }; },
    });

    // Second registration with same name should warn and skip
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    api.registerTool({
      name: 'dupe',
      description: 'Second',
      parameters: {},
      async execute() { return { content: [{ type: 'text', text: 'ok' }] }; },
    });

    expect(tools).toHaveLength(1);
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/plugins/plugin-api.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement plugin-api.ts**

Create `src/plugins/plugin-api.ts`:

```typescript
/**
 * Plugin API
 *
 * Creates the `api` object passed to plugin `register()` calls.
 * Collects tool registrations and provides AGiD extensions.
 */

import type {
  PluginAPI,
  AGiDExtensions,
  ToolRegistration,
  ToolRegistrationOptions,
  RegisteredPluginTool,
} from './types.js';

export function createPluginAPI(
  pluginId: string,
  toolCollector: RegisteredPluginTool[],
  agidExtensions?: AGiDExtensions | null,
  config?: Record<string, any>,
): PluginAPI {
  const registeredNames = new Set<string>();

  const api: PluginAPI = {
    registerTool(tool: ToolRegistration, options?: ToolRegistrationOptions): void {
      if (registeredNames.has(tool.name)) {
        console.warn(`[PluginAPI] Tool '${tool.name}' already registered by plugin '${pluginId}' — skipping duplicate`);
        return;
      }

      registeredNames.add(tool.name);
      toolCollector.push({
        registration: tool,
        options: options ?? {},
        pluginId,
      });
    },
    config,
    agid: agidExtensions ?? undefined,
  };

  return api;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/plugins/plugin-api.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/plugins/plugin-api.ts src/__tests__/plugins/plugin-api.test.ts
git commit -m "feat: add PluginAPI with registerTool and AGiD extensions"
```

---

### Task 4: Plugin Registry

**Files:**
- Create: `src/plugins/plugin-registry.ts`
- Create: `src/__tests__/plugins/plugin-registry.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/__tests__/plugins/plugin-registry.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { PluginRegistry } from '../../plugins/plugin-registry.js';

describe('PluginRegistry', () => {
  it('loads a plugin definition and collects its tools', () => {
    const registry = new PluginRegistry();

    registry.loadPlugin({
      manifest: { id: 'test' },
      definition: {
        id: 'test',
        name: 'Test',
        register(api) {
          api.registerTool({
            name: 'test_tool',
            description: 'A test',
            parameters: {},
            async execute() {
              return { content: [{ type: 'text', text: 'ok' }] };
            },
          });
        },
      },
      rootPath: '/tmp/test',
    });

    expect(registry.getTools()).toHaveLength(1);
    expect(registry.getTool('test_tool')).toBeDefined();
    expect(registry.getPlugins()).toHaveLength(1);
  });

  it('skips duplicate tool names across plugins', () => {
    const registry = new PluginRegistry();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    registry.loadPlugin({
      manifest: { id: 'plugin-a' },
      definition: {
        id: 'plugin-a',
        name: 'A',
        register(api) {
          api.registerTool({
            name: 'shared_tool',
            description: 'From A',
            parameters: {},
            async execute() { return { content: [{ type: 'text', text: 'a' }] }; },
          });
        },
      },
      rootPath: '/tmp/a',
    });

    registry.loadPlugin({
      manifest: { id: 'plugin-b' },
      definition: {
        id: 'plugin-b',
        name: 'B',
        register(api) {
          api.registerTool({
            name: 'shared_tool',
            description: 'From B',
            parameters: {},
            async execute() { return { content: [{ type: 'text', text: 'b' }] }; },
          });
        },
      },
      rootPath: '/tmp/b',
    });

    // First plugin wins
    expect(registry.getTools()).toHaveLength(1);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('executes a tool and returns result', async () => {
    const registry = new PluginRegistry();

    registry.loadPlugin({
      manifest: { id: 'test' },
      definition: {
        id: 'test',
        name: 'Test',
        register(api) {
          api.registerTool({
            name: 'echo',
            description: 'Echo input',
            parameters: {},
            async execute(_id, params) {
              return { content: [{ type: 'text', text: `echo: ${params.input}` }] };
            },
          });
        },
      },
      rootPath: '/tmp/test',
    });

    const result = await registry.executeTool('echo', { input: 'hello' });
    expect(result.content[0].text).toBe('echo: hello');
  });

  it('returns error for unknown tool', async () => {
    const registry = new PluginRegistry();
    const result = await registry.executeTool('nonexistent', {});
    expect(result.isError).toBe(true);
  });

  it('catches tool execution errors', async () => {
    const registry = new PluginRegistry();

    registry.loadPlugin({
      manifest: { id: 'test' },
      definition: {
        id: 'test',
        name: 'Test',
        register(api) {
          api.registerTool({
            name: 'broken',
            description: 'Throws',
            parameters: {},
            async execute() { throw new Error('boom'); },
          });
        },
      },
      rootPath: '/tmp/test',
    });

    const result = await registry.executeTool('broken', {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('boom');
  });

  it('calls destroy on all plugins during shutdown', async () => {
    const registry = new PluginRegistry();
    const destroyFn = vi.fn();

    registry.loadPlugin({
      manifest: { id: 'test' },
      definition: {
        id: 'test',
        name: 'Test',
        register(_api) {},
        destroy: destroyFn,
      },
      rootPath: '/tmp/test',
    });

    await registry.destroyAll();
    expect(destroyFn).toHaveBeenCalled();
  });

  it('continues shutdown even if destroy throws', async () => {
    const registry = new PluginRegistry();
    const secondDestroy = vi.fn();

    registry.loadPlugin({
      manifest: { id: 'first' },
      definition: {
        id: 'first',
        name: 'First',
        register(_api) {},
        async destroy() { throw new Error('cleanup failed'); },
      },
      rootPath: '/tmp/first',
    });

    registry.loadPlugin({
      manifest: { id: 'second' },
      definition: {
        id: 'second',
        name: 'Second',
        register(_api) {},
        destroy: secondDestroy,
      },
      rootPath: '/tmp/second',
    });

    await registry.destroyAll();
    expect(secondDestroy).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/plugins/plugin-registry.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement plugin-registry.ts**

Create `src/plugins/plugin-registry.ts`:

```typescript
/**
 * Plugin Registry
 *
 * Central registry that loads plugins, collects their tools,
 * and provides tool execution with error handling.
 */

import { createPluginAPI } from './plugin-api.js';
import type {
  PluginDefinition,
  PluginManifest,
  PluginToolResult,
  RegisteredPluginTool,
  LoadedPlugin,
  AGiDExtensions,
} from './types.js';
import { randomUUID } from 'crypto';

export interface LoadPluginInput {
  manifest: PluginManifest;
  definition: PluginDefinition;
  rootPath: string;
}

export class PluginRegistry {
  private plugins: LoadedPlugin[] = [];
  private tools = new Map<string, RegisteredPluginTool>();
  private agidExtensions?: AGiDExtensions;

  setAGiDExtensions(extensions: AGiDExtensions): void {
    this.agidExtensions = extensions;
  }

  loadPlugin(input: LoadPluginInput): void {
    const toolCollector: RegisteredPluginTool[] = [];

    try {
      const api = createPluginAPI(
        input.definition.id,
        toolCollector,
        this.agidExtensions,
      );

      input.definition.register(api);
    } catch (error) {
      console.error(`[PluginRegistry] Failed to register plugin '${input.definition.id}':`, error);
      return;
    }

    // Register tools, skipping conflicts
    for (const tool of toolCollector) {
      if (this.tools.has(tool.registration.name)) {
        console.warn(`[PluginRegistry] Tool '${tool.registration.name}' already exists — skipping from plugin '${tool.pluginId}'`);
        continue;
      }
      this.tools.set(tool.registration.name, tool);
    }

    const loadedPlugin: LoadedPlugin = {
      manifest: input.manifest,
      definition: input.definition,
      tools: new Map(toolCollector.map(t => [t.registration.name, t])),
      rootPath: input.rootPath,
    };

    this.plugins.push(loadedPlugin);
  }

  getTool(name: string): RegisteredPluginTool | undefined {
    return this.tools.get(name);
  }

  getTools(): RegisteredPluginTool[] {
    return [...this.tools.values()];
  }

  getPlugins(): LoadedPlugin[] {
    return [...this.plugins];
  }

  async executeTool(
    name: string,
    params: Record<string, unknown>,
    timeoutMs: number = 30_000,
  ): Promise<PluginToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        content: [{ type: 'text', text: `Unknown tool: ${name}` }],
        isError: true,
      };
    }

    const invocationId = randomUUID();

    try {
      const ctx = tool.registration.requiresWallet && this.agidExtensions
        ? { wallet: this.agidExtensions.wallet }
        : undefined;

      const result = await Promise.race([
        tool.registration.execute(invocationId, params, ctx),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Tool '${name}' timed out after ${timeoutMs}ms`)), timeoutMs)
        ),
      ]);

      return result;
    } catch (error) {
      return {
        content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
        isError: true,
      };
    }
  }

  async destroyAll(): Promise<void> {
    for (const plugin of this.plugins) {
      if (plugin.definition.destroy) {
        try {
          await plugin.definition.destroy();
        } catch (error) {
          console.error(`[PluginRegistry] Error destroying plugin '${plugin.definition.id}':`, error);
        }
      }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/plugins/plugin-registry.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/plugins/plugin-registry.ts src/__tests__/plugins/plugin-registry.test.ts
git commit -m "feat: add PluginRegistry with tool execution and lifecycle management"
```

---

### Task 5: Tool Access Control

**Files:**
- Create: `src/plugins/tool-access.ts`
- Create: `src/__tests__/plugins/tool-access.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/__tests__/plugins/tool-access.test.ts`:

```typescript
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
    const ac = new ToolAccessControl({
      profile: 'full',
      deny: ['exec'],
    });
    expect(ac.isAllowed('exec')).toBe(false);
  });

  it('allow adds tools on top of profile', () => {
    const ac = new ToolAccessControl({
      profile: 'minimal',
      allow: ['custom_tool'],
    });
    expect(ac.isAllowed('custom_tool')).toBe(true);
    expect(ac.isAllowed('exec')).toBe(false);
  });

  it('allows tool groups via group: prefix', () => {
    const ac = new ToolAccessControl({
      profile: 'minimal',
      allow: ['group:runtime'],
    });
    ac.registerToolGroup('runtime', ['exec', 'process']);
    expect(ac.isAllowed('exec')).toBe(true);
    expect(ac.isAllowed('process')).toBe(true);
    expect(ac.isAllowed('browser')).toBe(false);
  });

  it('handles optional tools (not allowed unless in allow list)', () => {
    const ac = new ToolAccessControl({ profile: 'full' });
    ac.registerOptionalTool('optional_tool');
    expect(ac.isAllowed('optional_tool')).toBe(false);

    const ac2 = new ToolAccessControl({
      profile: 'full',
      allow: ['optional_tool'],
    });
    ac2.registerOptionalTool('optional_tool');
    expect(ac2.isAllowed('optional_tool')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/plugins/tool-access.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement tool-access.ts**

Create `src/plugins/tool-access.ts`:

```typescript
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

    // Expand group: prefixes in allow list
    this.allow = new Set<string>();
    for (const entry of config.allow ?? []) {
      this.allow.add(entry);
    }
  }

  registerToolGroup(name: string, tools: string[]): void {
    this.groups.set(name, new Set(tools));
  }

  registerOptionalTool(name: string): void {
    this.optionalTools.add(name);
  }

  isAllowed(toolName: string): boolean {
    // Deny always wins
    if (this.deny.has(toolName)) return false;

    // Optional tools need explicit allow
    if (this.optionalTools.has(toolName)) {
      return this.isExplicitlyAllowed(toolName);
    }

    // Check explicit allow (including group expansion)
    if (this.isExplicitlyAllowed(toolName)) return true;

    // Check profile
    switch (this.profile) {
      case 'full':
        return true;
      case 'coding':
        return CODING_TOOLS.has(toolName);
      case 'minimal':
        return MINIMAL_TOOLS.has(toolName);
    }
  }

  private isExplicitlyAllowed(toolName: string): boolean {
    if (this.allow.has(toolName)) return true;

    // Check group expansions
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/plugins/tool-access.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/plugins/tool-access.ts src/__tests__/plugins/tool-access.test.ts
git commit -m "feat: add ToolAccessControl with profiles, allow/deny, and groups"
```

---

### Task 6: Plugin Loader (Manifest Discovery)

**Files:**
- Create: `src/plugins/plugin-loader.ts`
- Create: `src/__tests__/plugins/plugin-loader.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/__tests__/plugins/plugin-loader.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { readManifest, discoverPlugins } from '../../plugins/plugin-loader.js';
import { mkdtemp, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

describe('readManifest', () => {
  it('reads agid.plugin.json', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'plugin-test-'));
    await writeFile(join(dir, 'agid.plugin.json'), JSON.stringify({
      id: 'test-plugin',
      name: 'Test',
    }));

    const manifest = await readManifest(dir);
    expect(manifest).not.toBeNull();
    expect(manifest!.id).toBe('test-plugin');
  });

  it('falls back to openclaw.plugin.json', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'plugin-test-'));
    await writeFile(join(dir, 'openclaw.plugin.json'), JSON.stringify({
      id: 'oc-plugin',
      name: 'OpenClaw Plugin',
    }));

    const manifest = await readManifest(dir);
    expect(manifest).not.toBeNull();
    expect(manifest!.id).toBe('oc-plugin');
  });

  it('prefers agid.plugin.json over openclaw.plugin.json', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'plugin-test-'));
    await writeFile(join(dir, 'agid.plugin.json'), JSON.stringify({ id: 'agid-version' }));
    await writeFile(join(dir, 'openclaw.plugin.json'), JSON.stringify({ id: 'oc-version' }));

    const manifest = await readManifest(dir);
    expect(manifest!.id).toBe('agid-version');
  });

  it('returns null when no manifest found', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'plugin-test-'));
    const manifest = await readManifest(dir);
    expect(manifest).toBeNull();
  });

  it('returns null for invalid JSON', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'plugin-test-'));
    await writeFile(join(dir, 'agid.plugin.json'), 'not json');

    const manifest = await readManifest(dir);
    expect(manifest).toBeNull();
  });
});

describe('discoverPlugins', () => {
  it('discovers plugins in a directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'plugins-'));
    const pluginDir = join(dir, 'my-plugin');
    await mkdir(pluginDir);
    await writeFile(join(pluginDir, 'agid.plugin.json'), JSON.stringify({ id: 'my-plugin' }));

    const discovered = await discoverPlugins([dir]);
    expect(discovered).toHaveLength(1);
    expect(discovered[0].manifest.id).toBe('my-plugin');
  });

  it('skips directories without manifests', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'plugins-'));
    const noManifest = join(dir, 'no-manifest');
    await mkdir(noManifest);

    const discovered = await discoverPlugins([dir]);
    expect(discovered).toHaveLength(0);
  });

  it('handles nonexistent directories gracefully', async () => {
    const discovered = await discoverPlugins(['/tmp/nonexistent-dir-12345']);
    expect(discovered).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/plugins/plugin-loader.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement plugin-loader.ts**

Create `src/plugins/plugin-loader.ts`:

```typescript
/**
 * Plugin Loader
 *
 * Discovers plugins from configured directories,
 * reads manifests (agid.plugin.json or openclaw.plugin.json),
 * and prepares them for registration.
 */

import { readFile, readdir, stat } from 'fs/promises';
import { join } from 'path';
import type { PluginManifest, PluginDefinition } from './types.js';

export interface DiscoveredPlugin {
  manifest: PluginManifest;
  rootPath: string;
}

/**
 * Read a plugin manifest from a directory.
 * Prefers agid.plugin.json, falls back to openclaw.plugin.json.
 */
export async function readManifest(dir: string): Promise<PluginManifest | null> {
  for (const filename of ['agid.plugin.json', 'openclaw.plugin.json']) {
    try {
      const content = await readFile(join(dir, filename), 'utf-8');
      const manifest = JSON.parse(content) as PluginManifest;
      if (!manifest.id) {
        console.warn(`[PluginLoader] Manifest at ${join(dir, filename)} missing 'id' — skipping`);
        return null;
      }
      return manifest;
    } catch {
      // File not found or invalid — try next
    }
  }
  return null;
}

/**
 * Discover plugins in a list of directories.
 * Each subdirectory with a valid manifest is a plugin candidate.
 */
export async function discoverPlugins(dirs: string[]): Promise<DiscoveredPlugin[]> {
  const discovered: DiscoveredPlugin[] = [];

  for (const dir of dirs) {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      continue; // Directory doesn't exist
    }

    for (const entry of entries) {
      const pluginPath = join(dir, entry);
      try {
        const s = await stat(pluginPath);
        if (!s.isDirectory()) continue;
      } catch {
        continue;
      }

      const manifest = await readManifest(pluginPath);
      if (manifest) {
        discovered.push({ manifest, rootPath: pluginPath });
      }
    }
  }

  return discovered;
}

/**
 * Load a plugin module from a discovered plugin.
 * Reads package.json for the entry point (agid.extensions or openclaw.extensions),
 * then dynamically imports the module.
 */
export async function loadPluginModule(
  discovered: DiscoveredPlugin,
): Promise<PluginDefinition | null> {
  // Try to find entry point from package.json
  let entryPoint: string | null = null;

  try {
    const pkgJson = JSON.parse(await readFile(join(discovered.rootPath, 'package.json'), 'utf-8'));
    const extensions = pkgJson.agid?.extensions ?? pkgJson.openclaw?.extensions;
    if (extensions && extensions.length > 0) {
      entryPoint = extensions[0];
    }
  } catch {
    // No package.json — try index.ts / index.js
  }

  if (!entryPoint) {
    // Default entry points
    for (const candidate of ['./index.ts', './index.js', './dist/index.js']) {
      try {
        await stat(join(discovered.rootPath, candidate));
        entryPoint = candidate;
        break;
      } catch {
        continue;
      }
    }
  }

  if (!entryPoint) {
    console.warn(`[PluginLoader] No entry point found for plugin '${discovered.manifest.id}' at ${discovered.rootPath}`);
    return null;
  }

  try {
    const modulePath = join(discovered.rootPath, entryPoint);
    const mod = await import(modulePath);
    return mod.default ?? mod;
  } catch (error) {
    console.error(`[PluginLoader] Failed to load plugin '${discovered.manifest.id}':`, error);
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/plugins/plugin-loader.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/plugins/plugin-loader.ts src/__tests__/plugins/plugin-loader.test.ts
git commit -m "feat: add plugin loader with manifest discovery"
```

---

### Task 7: Skills Loader

**Files:**
- Create: `src/plugins/skills-loader.ts`
- Create: `src/__tests__/plugins/skills-loader.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/__tests__/plugins/skills-loader.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseSkillFile, discoverSkills } from '../../plugins/skills-loader.js';
import { mkdtemp, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

describe('parseSkillFile', () => {
  it('parses SKILL.md with YAML frontmatter', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'skill-'));
    const skillPath = join(dir, 'SKILL.md');
    await writeFile(skillPath, `---
name: test-skill
description: A test skill
user-invocable: true
---

Instructions for the agent.
`);

    const skill = await parseSkillFile(skillPath);
    expect(skill).not.toBeNull();
    expect(skill!.name).toBe('test-skill');
    expect(skill!.description).toBe('A test skill');
    expect(skill!.userInvocable).toBe(true);
    expect(skill!.body).toContain('Instructions for the agent.');
  });

  it('defaults user-invocable to true', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'skill-'));
    const skillPath = join(dir, 'SKILL.md');
    await writeFile(skillPath, `---
name: minimal
description: Minimal skill
---

Body.
`);

    const skill = await parseSkillFile(skillPath);
    expect(skill!.userInvocable).toBe(true);
  });

  it('parses agid metadata', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'skill-'));
    const skillPath = join(dir, 'SKILL.md');
    await writeFile(skillPath, `---
name: wallet-skill
description: Needs wallet
metadata:
  agid:
    requiresWallet: true
    auditable: true
---

Body.
`);

    const skill = await parseSkillFile(skillPath);
    expect(skill!.metadata?.agid?.requiresWallet).toBe(true);
    expect(skill!.metadata?.agid?.auditable).toBe(true);
  });

  it('returns null for files without frontmatter', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'skill-'));
    const skillPath = join(dir, 'SKILL.md');
    await writeFile(skillPath, 'Just plain text, no frontmatter.');

    const skill = await parseSkillFile(skillPath);
    expect(skill).toBeNull();
  });
});

describe('discoverSkills', () => {
  it('discovers SKILL.md files in subdirectories', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'skills-'));
    const skillDir = join(dir, 'my-skill');
    await mkdir(skillDir);
    await writeFile(join(skillDir, 'SKILL.md'), `---
name: discovered
description: Found it
---

Body.
`);

    const skills = await discoverSkills([dir]);
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('discovered');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/plugins/skills-loader.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement skills-loader.ts**

Create `src/plugins/skills-loader.ts`:

```typescript
/**
 * Skills Loader
 *
 * Discovers and parses SKILL.md files with YAML frontmatter.
 * Compatible with OpenClaw's skill format.
 */

import { readFile, readdir, stat } from 'fs/promises';
import { join } from 'path';
import { parse as parseYaml } from 'yaml';

export interface Skill {
  name: string;
  description: string;
  userInvocable: boolean;
  disableModelInvocation: boolean;
  commandDispatch?: string;
  commandTool?: string;
  commandArgMode?: string;
  metadata?: {
    agid?: { requiresWallet?: boolean; auditable?: boolean; category?: string };
    openclaw?: { requires?: { bins?: string[]; env?: string[] } };
  };
  body: string;
  filePath: string;
}

/**
 * Parse a SKILL.md file with YAML frontmatter.
 */
export async function parseSkillFile(filePath: string): Promise<Skill | null> {
  let content: string;
  try {
    content = await readFile(filePath, 'utf-8');
  } catch {
    return null;
  }

  // Extract YAML frontmatter
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return null;

  const [, frontmatterStr, body] = match;

  // Parse YAML frontmatter using the yaml package
  let frontmatter: Record<string, any>;
  try {
    frontmatter = parseYaml(frontmatterStr);
  } catch {
    console.warn(`[SkillsLoader] Invalid YAML in ${filePath} — skipping`);
    return null;
  }

  if (!frontmatter.name || !frontmatter.description) {
    console.warn(`[SkillsLoader] Skill at ${filePath} missing name or description — skipping`);
    return null;
  }

  return {
    name: frontmatter.name,
    description: frontmatter.description,
    userInvocable: frontmatter['user-invocable'] !== false,
    disableModelInvocation: frontmatter['disable-model-invocation'] === true,
    commandDispatch: frontmatter['command-dispatch'],
    commandTool: frontmatter['command-tool'],
    commandArgMode: frontmatter['command-arg-mode'],
    metadata: frontmatter.metadata,
    body: body.trim(),
    filePath,
  };
}

/**
 * Discover skills from a list of directories.
 * Each subdirectory containing a SKILL.md is a skill.
 * Dirs are ordered by precedence (highest first) — first-discovered wins
 * when multiple skills share the same name.
 */
export async function discoverSkills(dirs: string[]): Promise<Skill[]> {
  const seen = new Map<string, Skill>();

  for (const dir of dirs) {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      continue;
    }

    for (const entry of entries) {
      const entryPath = join(dir, entry);
      try {
        const s = await stat(entryPath);
        if (!s.isDirectory()) continue;
      } catch {
        continue;
      }

      const skillPath = join(entryPath, 'SKILL.md');
      const skill = await parseSkillFile(skillPath);
      if (skill && !seen.has(skill.name)) {
        seen.set(skill.name, skill);
      }
    }
  }

  return [...seen.values()];
}

```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/plugins/skills-loader.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/plugins/skills-loader.ts src/__tests__/plugins/skills-loader.test.ts
git commit -m "feat: add skills loader with SKILL.md parsing and discovery"
```

---

### Task 8: Bridge Plugin Registry to Existing ToolRegistry

**Files:**
- Modify: `src/agent/tool-registry.ts`
- Modify: `src/types/agent-types.ts`

- [ ] **Step 1: Add bridge method to ToolRegistry**

In `src/agent/tool-registry.ts`, add a method that takes tools from the `PluginRegistry` and registers them in the old `ToolRegistry` format using the result adapter:

```typescript
import { PluginRegistry } from '../../plugins/plugin-registry.js';
import { adaptNewResult } from '../../plugins/result-adapter.js';
```

Add method:

```typescript
  /**
   * Bridge: register all tools from the plugin registry into the old tool registry.
   * Uses the result adapter to convert new format to old format.
   */
  registerFromPluginRegistry(pluginRegistry: PluginRegistry): void {
    for (const pluginTool of pluginRegistry.getTools()) {
      const { registration, options } = pluginTool;

      if (this.tools.has(registration.name)) {
        console.warn(`[ToolRegistry] Tool '${registration.name}' already exists — skipping plugin tool`);
        continue;
      }

      if (registration.requiresWallet) {
        this.walletTools.add(registration.name);
      }

      this.register({
        definition: {
          name: registration.name,
          description: registration.description,
          input_schema: {
            type: 'object',
            properties: registration.parameters?.properties ?? registration.parameters ?? {},
            required: registration.parameters?.required,
          },
        },
        execute: async (params) => {
          const result = await pluginRegistry.executeTool(registration.name, params);
          return adaptNewResult(result);
        },
      });
    }
    this.definitionsCache = null;
  }
```

- [ ] **Step 2: Run existing tests**

Run: `npx vitest run`
Expected: PASS (no tests broken — this is an additive method)

- [ ] **Step 3: Commit**

```bash
git add src/agent/tool-registry.ts
git commit -m "feat: bridge PluginRegistry into existing ToolRegistry"
```

---

### Task 9: Plugin System Index & Integration Test

**Files:**
- Create: `src/plugins/index.ts`
- Create: `src/__tests__/plugins/integration.test.ts`

- [ ] **Step 1: Create plugin system index**

Create `src/plugins/index.ts`:

```typescript
/**
 * Plugin System
 *
 * Re-exports the public API of the plugin system.
 */

export { definePluginEntry } from './define-plugin-entry.js';
export { PluginRegistry } from './plugin-registry.js';
export { createPluginAPI } from './plugin-api.js';
export { ToolAccessControl } from './tool-access.js';
export { discoverPlugins, readManifest, loadPluginModule } from './plugin-loader.js';
export { discoverSkills, parseSkillFile } from './skills-loader.js';
export { adaptOldResult, adaptNewResult, isOldFormat } from './result-adapter.js';
export type {
  PluginDefinition,
  PluginAPI,
  PluginManifest,
  PluginToolResult,
  ToolRegistration,
  ToolRegistrationOptions,
  RegisteredPluginTool,
  LoadedPlugin,
  AGiDExtensions,
  ToolExecutionContext,
} from './types.js';
export type { Skill } from './skills-loader.js';
```

- [ ] **Step 2: Write integration test**

Create `src/__tests__/plugins/integration.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { definePluginEntry } from '../../plugins/define-plugin-entry.js';
import { PluginRegistry } from '../../plugins/plugin-registry.js';
import { ToolAccessControl } from '../../plugins/tool-access.js';
import { adaptNewResult } from '../../plugins/result-adapter.js';

describe('plugin system integration', () => {
  it('full lifecycle: define → register → access control → execute → destroy', async () => {
    let destroyed = false;

    // 1. Define a plugin
    const plugin = definePluginEntry({
      id: 'integration-test',
      name: 'Integration Test Plugin',
      register(api) {
        api.registerTool({
          name: 'greet',
          description: 'Greet someone',
          parameters: { type: 'object', properties: { name: { type: 'string' } } },
          async execute(_id, params) {
            return { content: [{ type: 'text', text: `Hello, ${params.name}!` }] };
          },
        });

        api.registerTool(
          {
            name: 'secret_tool',
            description: 'Optional secret',
            parameters: {},
            async execute() {
              return { content: [{ type: 'text', text: 'secret' }] };
            },
          },
          { optional: true },
        );
      },
      async destroy() {
        destroyed = true;
      },
    });

    // 2. Load into registry
    const registry = new PluginRegistry();
    registry.loadPlugin({
      manifest: { id: 'integration-test' },
      definition: plugin,
      rootPath: '/tmp/test',
    });

    expect(registry.getTools()).toHaveLength(2);

    // 3. Access control
    const ac = new ToolAccessControl({ profile: 'full' });
    const tools = registry.getTools();
    for (const tool of tools) {
      if (tool.options.optional) {
        ac.registerOptionalTool(tool.registration.name);
      }
    }

    expect(ac.isAllowed('greet')).toBe(true);
    expect(ac.isAllowed('secret_tool')).toBe(false); // Optional, not in allow list

    // 4. Execute a tool
    const result = await registry.executeTool('greet', { name: 'World' });
    expect(result.content[0].text).toBe('Hello, World!');

    // 5. Convert to old format for legacy consumers
    const oldResult = adaptNewResult(result);
    expect(oldResult.content).toBe('Hello, World!');

    // 6. Destroy
    await registry.destroyAll();
    expect(destroyed).toBe(true);
  });
});
```

- [ ] **Step 3: Run integration test**

Run: `npx vitest run src/__tests__/plugins/integration.test.ts`
Expected: PASS

- [ ] **Step 4: Run full test suite**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/plugins/index.ts src/__tests__/plugins/integration.test.ts
git commit -m "feat: add plugin system index and integration test"
```

---

## Summary

| Task | Component | Steps |
|------|-----------|-------|
| 1 | Types + definePluginEntry | 6 |
| 2 | Result Adapter | 5 |
| 3 | Plugin API (registerTool) | 5 |
| 4 | Plugin Registry | 5 |
| 5 | Tool Access Control | 5 |
| 6 | Plugin Loader (manifests) | 5 |
| 7 | Skills Loader | 5 |
| 8 | Bridge to ToolRegistry | 3 |
| 9 | Index + Integration Test | 5 |
| **Total** | | **44 steps** |

Tasks 1-7 are independent new modules. Task 8 bridges the new plugin system into the existing tool registry. Task 9 ties everything together with an integration test. After this plan ships, sub-project 2 (core tool migration) can begin migrating the 50 existing tools into plugins.
