# AGiD Plugin Architecture & OpenClaw Compatibility

**Date:** 2026-03-21
**Status:** Draft

## Overview

Restructure AGiD so that every tool is a plugin, the plugin/skill system is OpenClaw-compatible, and the same AGiD plugins can run inside OpenClaw as a single `@agid/openclaw-plugin` package with an embedded wallet-toolbox. AGiD becomes a standalone platform with full agent capabilities (exec, file ops, browser) while maintaining its differentiator: cryptographic identity, auditable actions, and provably private interactions.

## Goals

1. All AGiD tools become plugins using OpenClaw-compatible `register(api)` pattern
2. Plugin runtime supports OpenClaw manifests (`openclaw.plugin.json`) natively
3. Skills system uses OpenClaw's `SKILL.md` format with AGiD extensions
4. Add missing general-purpose tools (exec/process, file ops, browser) as plugins
5. Ship `@agid/openclaw-plugin` npm package for OpenClaw users
6. Remove niche tools (Base2, X/Twitter, x402, overlay lookup, discover_services, create_skill)

## Non-Goals

- Building messaging channels (WhatsApp, Telegram, etc.) — AGiD uses MessageBox
- Canvas/nodes/device pairing — not needed for enterprise compliance use cases
- Automated wallet onboarding UX — white-glove for now
- Image generation/analysis tools — deferred to API overlay layer

---

## 1. Plugin Runtime

### 1.1 Plugin Registration API

The plugin entry point follows OpenClaw's pattern exactly:

```typescript
import { definePluginEntry } from "agid/plugin-sdk/plugin-entry";

export default definePluginEntry({
  id: "my-plugin",
  name: "My Plugin",
  register(api) {
    api.registerTool({
      name: "my_tool",
      description: "Do a thing",
      parameters: Type.Object({ input: Type.String() }),
      async execute(id, params) {
        return { content: [{ type: "text", text: "result" }] };
      }
    });
  }
});
```

AGiD extends the `api` object with blockchain capabilities:

```typescript
register(api) {
  // Standard tools (OpenClaw-compatible)
  api.registerTool({ ... });

  // AGiD extensions (only available in AGiD runtime)
  if (api.agid) {
    api.agid.wallet    // BRC-100 wallet access
    api.agid.audit     // Audit logging to blockchain
    api.agid.identity  // Identity/certificate operations
  }
}
```

OpenClaw plugins that don't reference `api.agid` work unchanged. AGiD plugins use the extended interface.

### 1.2 Tool Registration

```typescript
api.registerTool({
  name: string;              // Tool name (must not clash with core)
  description: string;       // LLM-facing description
  parameters: TSchema;       // TypeBox or JSON Schema object (both accepted)
  execute(id: string, params: any, ctx?: ToolContext): Promise<ToolResult>;
}, options?: {
  optional?: boolean;        // User must add to tools.allow
  group?: string;            // Tool group for access control
});
```

The `id` parameter is a unique invocation ID generated per tool call (for audit logging and tracing). The existing AGiD `execute(params, ctx)` signature differs — migrated tools need to add the `id` first parameter. The plugin runtime adapter handles this during the transition period by injecting a generated ID for old-style tools.

**Tool result format (OpenClaw-compatible):**
```typescript
interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}
```

**Migration from current format:** The existing AGiD `ToolResult` uses `{ content: string; isError?: boolean }`. During migration, an adapter wraps old-style results into the new format:
```typescript
function adaptResult(old: { content: string; isError?: boolean }): ToolResult {
  return {
    content: [{ type: "text", text: old.content }],
    isError: old.isError,
  };
}
```
The adapter runs in the plugin runtime's tool dispatch layer. Old tools work unchanged until migrated. New tools use the new format directly.

**AGiD-extended tool registration:**
```typescript
api.registerTool({
  name: string;
  description: string;
  parameters: TSchema;
  requiresWallet?: boolean;   // AGiD: inject wallet into context
  auditable?: boolean;        // AGiD: auto-log to audit chain
  execute(id, params, ctx?): Promise<ToolResult>;
});
```

When `requiresWallet: true`, the `ctx` argument includes `ctx.wallet`. When `auditable: true`, the tool execution is automatically logged to the audit chain.

### 1.3 Plugin Manifest

**AGiD manifest (`agid.plugin.json`):**
```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "description": "What it does",
  "kind": "tools",
  "configSchema": {},
  "skills": ["./skills"]
}
```

**OpenClaw manifest (`openclaw.plugin.json`) also recognized** — same fields, loaded identically. If both exist, `agid.plugin.json` takes precedence.

**Package.json metadata:**
```json
{
  "name": "@agid/my-plugin",
  "openclaw": {
    "extensions": ["./index.ts"]
  },
  "agid": {
    "extensions": ["./index.ts"]
  }
}
```

Both `openclaw` and `agid` sections are recognized. This allows the same package to be discovered by both runtimes.

### 1.4 Plugin Discovery & Loading

**Discovery order:**
1. Built-in plugins (shipped with AGiD)
2. Managed plugins (`~/.agid/plugins/`)
3. Workspace plugins (`<workspace>/plugins/`)
4. npm-installed plugins

**Load pipeline:**
1. Discover plugin roots
2. Read manifests (`agid.plugin.json` or `openclaw.plugin.json`)
3. Validate config schema
4. Load plugin modules
5. Call `register(api)` for each plugin
6. Register tools into central tool registry

**Plugins run in-process** (same as OpenClaw — no sandboxing). A plugin bug can crash the gateway. This matches OpenClaw's trust model.

### 1.5 Plugin Lifecycle

```typescript
export default definePluginEntry({
  id: "my-plugin",
  name: "My Plugin",
  register(api) {
    // Called during gateway startup — register tools, hooks, etc.
  },
  async destroy() {
    // Called during gateway shutdown — cleanup resources
    // Close SQLite connections, kill child processes, stop Playwright, etc.
  }
});
```

The gateway calls `destroy()` on all loaded plugins during graceful shutdown. If `destroy()` throws, the error is logged but does not block other plugins from shutting down.

### 1.6 Error Handling

**Plugin load errors:**
- Invalid manifest (bad JSON, missing `id`) → skip plugin, log warning, continue
- Module not found → skip plugin, log warning, continue
- `register()` throws → skip plugin, log error, continue
- Other plugins continue loading — one broken plugin does not take down the gateway

**Tool execution errors:**
- `execute()` throws → return `{ content: [{ type: "text", text: error.message }], isError: true }` to the LLM
- `execute()` times out → kill execution, return timeout error to the LLM
- The agent loop handles `isError: true` results the same as the current `isError` field

**Tool name conflicts:**
- If a plugin registers a tool name that already exists, the duplicate is skipped and a warning is logged (same as OpenClaw)

### 1.7 Tool Access Control

Same system as OpenClaw:

```json5
{
  tools: {
    profile: "full",           // full | coding | minimal
    allow: ["optional_tool"],  // explicit allowlist
    deny: ["dangerous_tool"],  // deny always wins
  }
}
```

**Tool groups:**
- `group:runtime` — exec, process
- `group:fs` — read, write, edit, apply_patch
- `group:browser` — browser
- `group:identity` — AGiD identity, certs, ZK proofs
- `group:crypto` — encrypt, decrypt, sign, verify
- `group:wallet` — transactions, tokens, payments
- `group:memory` — store, recall, shad
- `group:messaging` — MessageBox tools
- `group:audit` — verification tools
- `group:agid` — all AGiD-specific tools

---

## 2. Skills System

### 2.1 Skill Format

Same as OpenClaw's `SKILL.md` with YAML frontmatter:

```markdown
---
name: compliance-audit
description: Audit agent actions for regulatory compliance
user-invocable: true
metadata:
  agid:
    requiresWallet: true
    auditable: true
    category: compliance
  openclaw:
    requires: { bins: [], env: [] }
---

Skill instructions injected into system prompt...
```

**Required frontmatter:** `name`, `description`

**Optional frontmatter:**
- `user-invocable` (boolean, default true) — expose as slash command
- `disable-model-invocation` (boolean, default false) — exclude from prompt
- `command-dispatch` — set to `tool` for direct tool invocation
- `command-tool` — tool name for direct dispatch
- `command-arg-mode` — `raw` (default)
- `metadata.agid` — AGiD-specific requirements
- `metadata.openclaw` — OpenClaw-compatible requirements

### 2.2 Skill Loading

**Loading order (highest to lowest precedence):**
1. Workspace skills: `<workspace>/skills/`
2. Managed skills: `~/.agid/skills/`
3. Plugin skills: declared in plugin manifest `skills` field
4. Bundled skills: shipped with AGiD
5. Extra dirs: `skills.load.extraDirs` config

Skills are snapshotted at session start by default. When `skills.load.watch` is enabled, a file watcher detects changes and refreshes eligible skills mid-session (same behavior as OpenClaw).

---

## 3. Plugin Packages

### 3.1 Existing Tools (Migrated to Plugins)

| Plugin ID | Tools | Count |
|-----------|-------|-------|
| `agid-identity` | agid_identity, agid_balance, agid_get_public_key, agid_get_height, agid_lookup_identity, agid_cert_issue, agid_cert_receive, agid_cert_list, agid_cert_verify, agid_cert_revoke, agid_cert_reveal, agid_cert_check_revocation, agid_cert_send, agid_zkproof_privilege, agid_zkproof_verify, agid_zkproof_selective_reveal, agid_zkproof_commitment, agid_zkproof_verify_commitment | 18 |
| `agid-crypto` | agid_sign, agid_encrypt, agid_decrypt, agid_wallet_client_request, agid_request_user_signature | 5 |
| `agid-wallet` | agid_create_action, agid_internalize_action, agid_list_outputs, agid_send_payment, agid_token_create, agid_token_list, agid_token_redeem | 7 |
| `agid-memory` | agid_store_memory, agid_recall_memories, shad_deep_recall, shad_search_memories | 4 |
| `agid-messaging` | agid_message_send, agid_message_list, agid_message_ack, agid_list_payments, agid_accept_payment | 5 |
| `agid-audit` | agid_verify_workspace, agid_verify_session | 2 |
| `agid-optimize` | agid_optimize_prompt | 1 |
| `agid-deploy` | agid_mandala_create_project, agid_mandala_list_projects, agid_mandala_project_info, agid_mandala_deploy, agid_mandala_update_settings, agid_mandala_project_logs, agid_mandala_manage_admins, agid_mandala_node_info | 8 |
| **Subtotal** | | **50** |

### 3.2 New Tools (Built as Plugins)

| Plugin ID | Tools | Count | Implementation |
|-----------|-------|-------|----------------|
| `agid-runtime` | exec, process | 2 | Node `child_process`, PTY, background sessions |
| `agid-fs` | read, write, edit, apply_patch | 4 | Workspace-scoped file operations |
| `agid-browser` | browser | 1 | Playwright, headless Chromium |
| **Subtotal** | | **7** |

### 3.3 Removed Tools

| Tool | Reason |
|------|--------|
| agid_publish_content | Base2 — niche |
| agid_fund_calibration | Base2 — niche |
| agid_read_calibrations | Base2 — niche |
| agid_split_test | Base2 — niche |
| agid_x_search | X/Twitter — deferred |
| agid_x_profile | X/Twitter — deferred |
| agid_x_thread | X/Twitter — deferred |
| agid_x_trending | X/Twitter — deferred |
| agid_x_tweet | X/Twitter — deferred |
| agid_x402_request | Deferred to API overlay |
| agid_discover_services | Deferred to API overlay |
| agid_overlay_lookup | Deferred to API overlay |
| agid_create_skill | Replaced by skills system |
| **Total removed** | **13** |

### 3.4 Total: 11 plugin packages, 57 tools (63 original - 13 removed + 7 new)

---

## 4. OpenClaw Plugin Package

### 4.1 Package Structure

Published as `@agid/openclaw-plugin`:

```
@agid/openclaw-plugin/
├── package.json
├── openclaw.plugin.json
├── index.ts
└── src/
    ├── identity.ts
    ├── crypto.ts
    ├── wallet.ts
    ├── memory.ts
    ├── messaging.ts
    ├── audit.ts
    ├── optimize.ts
    └── deploy.ts
```

**package.json:**
```json
{
  "name": "@agid/openclaw-plugin",
  "version": "1.0.0",
  "type": "module",
  "openclaw": {
    "extensions": ["./index.ts"]
  }
}
```

**openclaw.plugin.json:**
```json
{
  "id": "agid",
  "name": "AGiD — Auditable Agent Identity",
  "description": "Cryptographic identity, auditable actions, provably private interactions for AI agents",
  "kind": "tools",
  "configSchema": {
    "type": "object",
    "properties": {
      "storage": { "type": "string", "enum": ["local", "cloud"], "default": "local" },
      "network": { "type": "string", "enum": ["mainnet", "testnet"], "default": "testnet" },
      "storagePath": { "type": "string", "default": "~/.agid/wallet.sqlite" }
    }
  }
}
```

### 4.2 Entry Point

```typescript
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

export default definePluginEntry({
  id: "agid",
  name: "AGiD — Auditable Agent Identity",
  register(api) {
    const config = api.config?.plugins?.entries?.agid ?? {};

    // Lazy wallet initialization — wallet is created on first tool use,
    // not at registration time. This avoids async issues in register()
    // and skips wallet setup if no AGiD tools are actually called.
    let walletPromise: Promise<AgentWallet> | null = null;
    function getWallet() {
      if (!walletPromise) {
        walletPromise = initWallet({
          storage: config.storage ?? 'local',
          network: config.network ?? 'testnet',
          storagePath: config.storagePath ?? '~/.agid/wallet.sqlite',
        });
      }
      return walletPromise;
    }

    // Register all AGiD tools with lazy wallet access
    registerIdentityTools(api, getWallet);
    registerCryptoTools(api, getWallet);
    registerWalletTools(api, getWallet);
    registerMemoryTools(api, getWallet);
    registerMessagingTools(api, getWallet);
    registerAuditTools(api, getWallet);
    registerOptimizeTools(api, getWallet);
    registerDeployTools(api, getWallet);
  },
  async destroy() {
    // Cleanup wallet connection on shutdown
    if (walletPromise) {
      const wallet = await walletPromise;
      await wallet.destroy?.();
    }
  }
});
```

### 4.3 Wallet in Plugin

The plugin embeds a full `@bsv/wallet-toolbox` instance:
- **Local storage:** SQLite at configured path (default `~/.agid/wallet.sqlite`)
- **Cloud storage:** UHRP-backed with local cache (uses the sync scheduler from the memory system)
- **Network:** Configurable mainnet/testnet
- **Keys:** Generated on first run, stored in the SQLite database
- **No remote wallet service** — the wallet runs inside the plugin process

OpenClaw users install and configure:
```bash
openclaw plugins install @agid/openclaw-plugin
```

```json5
// ~/.openclaw/openclaw.json
{
  plugins: {
    entries: {
      agid: {
        storage: "local",
        network: "testnet"
      }
    }
  }
}
```

---

## 5. Migration Strategy

### 5.1 Old Tool Registry Coexistence

During migration, both systems run simultaneously:

1. **Phase 1:** Build plugin runtime, register new tools (exec, fs, browser) as plugins
2. **Phase 2:** Migrate existing tools one category at a time to plugins
3. **Phase 3:** Remove old `createAllTools()` registry once all tools are migrated
4. **Phase 4:** Ship `@agid/openclaw-plugin` package

Each phase is independently deployable. The agent loop checks both the old tool registry and the new plugin registry until migration is complete.

### 5.2 Migration Order

1. `agid-audit` (2 tools) — smallest, good test case
2. `agid-optimize` (1 tool) — trivial
3. `agid-messaging` (5 tools) — moderate
4. `agid-crypto` (5 tools) — moderate
5. `agid-wallet` (7 tools) — moderate, depends on wallet injection
6. `agid-memory` (4 tools) — depends on coordinator/verifier
7. `agid-identity` (18 tools) — largest, most complex
8. `agid-deploy` (8 tools) — independent

---

## 6. Configuration

### 6.1 AGiD Config

The plugin/skills/tools config uses a JSON5 config file at `~/.agid/agid.json`. This is separate from the existing `AGIdentityEnvConfig` which remains env-var based. The existing `loadConfig()` continues to work for wallet, UHRP, Shad, and server settings. The new config file handles plugin/skill/tool settings that don't map well to flat env vars. Both are loaded at startup.

```json5
{
  // Plugin system
  plugins: {
    dirs: ["~/.agid/plugins"],
    entries: {
      "agid-browser": { enabled: true },
      "agid-runtime": { enabled: true },
    }
  },

  // Skills system
  skills: {
    load: {
      watch: true,
      extraDirs: []
    },
    entries: {
      "compliance-audit": { enabled: true }
    }
  },

  // Tool access control
  tools: {
    profile: "full",
    allow: [],
    deny: []
  },

  // Existing AGiD config (unchanged)
  network: "testnet",
  // ...
}
```

### 6.2 Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `AGID_PLUGIN_DIRS` | `~/.agid/plugins` | Additional plugin directories |
| `AGID_SKILLS_WATCH` | `true` | Hot-reload skills on change |
| `AGID_TOOLS_PROFILE` | `full` | Tool access profile |

---

## 7. Architecture Diagram

```
AGiD Standalone:
  Gateway
    → Plugin Runtime (loads agid.plugin.json + openclaw.plugin.json)
      → agid-identity plugin (18 tools, wallet access)
      → agid-crypto plugin (5 tools, wallet access)
      → agid-wallet plugin (7 tools, wallet access)
      → agid-memory plugin (4 tools, wallet + shad)
      → agid-messaging plugin (5 tools, MessageBox)
      → agid-audit plugin (2 tools, blockchain proofs)
      → agid-optimize plugin (1 tool, GEPA)
      → agid-deploy plugin (8 tools, Mandala)
      → agid-runtime plugin (2 tools, exec/process)
      → agid-fs plugin (4 tools, file ops)
      → agid-browser plugin (1 tool, Playwright)
      → [any OpenClaw-compatible plugin]
    → Skills Loader (SKILL.md files)
    → Agent Loop (tool dispatch, audit logging)
    → Wallet (wallet-toolbox, local SQLite)

OpenClaw + AGiD Plugin:
  OpenClaw Gateway
    → OpenClaw Plugin Runtime
      → @agid/openclaw-plugin
        → Embedded wallet-toolbox
        → All AGiD tools registered via api.registerTool()
      → [other OpenClaw plugins]
    → OpenClaw Skills/Tools
    → OpenClaw Agent Loop

Same plugin code → two runtimes
```
