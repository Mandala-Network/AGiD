# Remaining Migration & Sub-Project Plans

> **Context for fresh agents:** This document contains plans for completing the AGiD plugin architecture. Sub-project 1 (Plugin Runtime) and Migration Batch A (audit + optimize + messaging = 8 tools) are DONE on branch `feat/plugin-runtime`. These plans cover everything remaining.

**Key references:**
- Spec: `docs/superpowers/specs/2026-03-21-plugin-architecture-design.md`
- Plugin runtime: `src/plugins/` (types, define-plugin-entry, plugin-api, plugin-registry, tool-access, plugin-loader, skills-loader, result-adapter)
- Builtin plugins: `src/plugins/builtin/` (agid-audit, agid-optimize, agid-messaging already done)
- Old tool registry: `src/agent/tools/index.ts` (`createAllTools()` — still has 42 tools)
- Bridge: `src/agent/tool-registry.ts` has `registerFromPluginRegistry()` method

**Migration pattern (same for every tool):**
1. Create `src/plugins/builtin/agid-<name>.ts` using `definePluginEntry`
2. Each tool uses `api.registerTool()` with:
   - `parameters` = same JSON Schema as old `input_schema`
   - `execute(id, params, ctx)` = new signature (id is invocation UUID, ctx has optional wallet)
   - Returns `{ content: [{ type: 'text', text: JSON.stringify(data) }] }` (new format)
   - `requiresWallet` and group set via options
3. Create test: `src/__tests__/plugins/builtin/agid-<name>.test.ts`
4. Remove from `createAllTools()` in `src/agent/tools/index.ts`

---

## Plan 1: Migration Batch B — Crypto + Wallet (12 tools)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Migrate 12 wallet-dependent tools (crypto 5, wallet 7) to plugins.

**Architecture:** Two plugin packages. Crypto tools get wallet via `ctx.wallet` for signing/encryption. Wallet tools use `ctx.wallet.getUnderlyingWallet()` for transaction/token operations.

**Tech Stack:** TypeScript, vitest, @bsv/sdk (HTTPWalletJSON, PushDrop)

### Task 1: agid-crypto Plugin (5 tools)

**Source files to read first:**
- `src/agent/tools/wallet-ops.ts` — 3 tools (sign, encrypt, decrypt)
- `src/agent/tools/wallet-client.ts` — 2 tools (wallet_client_request, request_user_signature)

**Create:** `src/plugins/builtin/agid-crypto.ts`
**Test:** `src/__tests__/plugins/builtin/agid-crypto.test.ts`

**Tools to migrate:**

| Tool Name | Source | requiresWallet | Group |
|-----------|--------|---------------|-------|
| `agid_sign` | wallet-ops.ts:8-33 | true | crypto |
| `agid_encrypt` | wallet-ops.ts:36-63 | true | crypto |
| `agid_decrypt` | wallet-ops.ts:65-93 | true | crypto |
| `agid_wallet_client_request` | wallet-client.ts:9-74 | false | crypto |
| `agid_request_user_signature` | wallet-client.ts:77-140 | false | crypto |

**Key details:**
- `agid_sign` uses `ctx.wallet.createSignature()` with `protocolID: [0, protocol]`
- `agid_encrypt`/`agid_decrypt` use `ctx.wallet.encrypt()`/`ctx.wallet.decrypt()`
- `agid_wallet_client_request` uses `HTTPWalletJSON` from `@bsv/sdk` — does NOT need agent wallet
- `agid_request_user_signature` also uses `HTTPWalletJSON` — does NOT need agent wallet
- Both wallet-client tools take an optional `walletClientUrl` param defaulting to env `AGID_WALLET_CLIENT_URL` or `http://localhost:3301`

**Test assertions:**
- 5 tools registered
- All in group `crypto`
- sign/encrypt/decrypt require wallet
- wallet_client_request/request_user_signature do NOT require wallet

**After implementation:** Remove `walletOpsTools` and `walletClientTools` imports and spreads from `createAllTools()`.

### Task 2: agid-wallet Plugin (7 tools)

**Source files to read first:**
- `src/agent/tools/transactions.ts` — 4 tools (create_action, internalize_action, list_outputs, send_payment)
- `src/agent/tools/tokens.ts` — 3 tools (token_create, token_list, token_redeem)
- `src/wallet/pushdrop-ops.ts` — lockPushDropToken, decodePushDropToken, unlockPushDropToken

**Create:** `src/plugins/builtin/agid-wallet.ts`
**Test:** `src/__tests__/plugins/builtin/agid-wallet.test.ts`

**Tools to migrate:**

| Tool Name | Source | requiresWallet | Group |
|-----------|--------|---------------|-------|
| `agid_create_action` | transactions.ts:8-51 | true | wallet |
| `agid_internalize_action` | transactions.ts:53-89 | true | wallet |
| `agid_list_outputs` | transactions.ts:91-120 | false | wallet |
| `agid_send_payment` | transactions.ts:122-147 | true | wallet |
| `agid_token_create` | tokens.ts:9-37 | true | wallet |
| `agid_token_list` | tokens.ts:39-73 | false | wallet |
| `agid_token_redeem` | tokens.ts:76-103 | true | wallet |

**Key details:**
- Transaction tools use `ctx.wallet.getUnderlyingWallet()` to access the raw SDK wallet
- `send_payment` uses `ctx.wallet.getPeerPayClient()`
- Token tools import from `../../wallet/pushdrop-ops.js` — update import paths to `../../../wallet/pushdrop-ops.js` or adjust relative path from builtin dir
- `token_create` uses `lockPushDropToken(ctx.wallet, {...})`
- `token_list` uses `decodePushDropToken(lockingScript)`
- `token_redeem` uses `unlockPushDropToken(underlyingWallet, {...})`

**Test assertions:**
- 7 tools registered
- All in group `wallet`
- create_action, internalize_action, send_payment, token_create, token_redeem require wallet
- list_outputs, token_list do NOT require wallet

**After implementation:** Remove `transactionTools` and `tokenTools` imports and spreads from `createAllTools()`.

### Task 3: Update createAllTools() — Remove Batch B tools

Remove from `src/agent/tools/index.ts`:
- `import { walletOpsTools } from './wallet-ops.js';`
- `import { walletClientTools } from './wallet-client.js';`
- `import { transactionTools } from './transactions.js';`
- `import { tokenTools } from './tokens.js';`
- `...walletOpsTools(),`
- `...walletClientTools(),`
- `...transactionTools(),`
- `...tokenTools(),`

Update the builtin index at `src/plugins/builtin/index.ts` to export the new plugins.

---

## Plan 2: Migration Batch C — Memory + Identity + Deploy (30 tools)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Migrate the remaining 30 tools plus remove deprecated tools (calibration, x-research, skill-creator).

**Architecture:** Three plugin packages. Memory tools need `MemoryManager` from context. Identity tools are the largest package (18 tools across identity, certificates, ZK proofs). Deploy tools use `MandalaClient`.

**Tech Stack:** TypeScript, vitest, @bsv/sdk, peercert, PrivateKey/PublicKey/Schnorr

### Task 1: agid-memory Plugin (4 tools)

**Source files to read first:**
- `src/agent/tools/memory.ts` — 2 tools (store_memory, recall_memories)
- `src/agent/tools/shad.ts` — 2 tools (shad_deep_recall, shad_search_memories)

**Create:** `src/plugins/builtin/agid-memory.ts`
**Test:** `src/__tests__/plugins/builtin/agid-memory.test.ts`

**Tools to migrate:**

| Tool Name | Source | requiresWallet | Group |
|-----------|--------|---------------|-------|
| `agid_store_memory` | memory.ts:8-27 | true | memory |
| `agid_recall_memories` | memory.ts:29-62 | false | memory |
| `shad_deep_recall` | shad.ts:18-63 | false | memory |
| `shad_search_memories` | shad.ts:65-101 | false | memory |

**Key details:**
- ALL 4 tools require `ctx.memoryManager` (not wallet) — but `store_memory` also needs wallet for PushDrop
- The `MemoryManager` is NOT part of the standard `ToolExecutionContext` from the plugin system. Two options:
  - **Option A:** Pass MemoryManager via AGiD extensions (`api.agid.memoryManager`)
  - **Option B:** Initialize MemoryManager inside the plugin's `register()` using the wallet from `api.agid`
- **Recommended:** Option A — add `memoryManager` to `AGiDExtensions` type in `src/plugins/types.ts`
- `store_memory` calls `ctx.memoryManager.store({ content, tags })`
- `recall_memories` calls `ctx.memoryManager.recall({ tags, limit, semantic, query, ... })`
- `shad_deep_recall` calls `ctx.memoryManager.recall({ semantic: true, query, strategy, ... })`
- `shad_search_memories` calls `ctx.memoryManager.quickRecall(query, limit)`

**Type change needed:** Update `AGiDExtensions` in `src/plugins/types.ts`:
```typescript
export interface AGiDExtensions {
  wallet: any;
  audit: any;
  identity: any;
  memoryManager?: any;  // Add this
}
```

**Test assertions:**
- 4 tools registered
- All in group `memory`
- store_memory requires wallet
- recall_memories, shad tools do NOT require wallet

### Task 2: agid-identity Plugin (18 tools)

This is the largest plugin. It combines three old tool files.

**Source files to read first:**
- `src/agent/tools/identity.ts` — 5 tools
- `src/agent/tools/certificates.ts` — 8 tools (uses PeerCert from 'peercert')
- `src/agent/tools/zkproof-ops.ts` — 5 tools (uses PrivateKey, PublicKey, Schnorr, Point from @bsv/sdk)

**Create:** `src/plugins/builtin/agid-identity.ts`
**Test:** `src/__tests__/plugins/builtin/agid-identity.test.ts`

**Tools to migrate:**

| Tool Name | Source | requiresWallet | Group |
|-----------|--------|---------------|-------|
| `agid_identity` | identity.ts:9-20 | false | identity |
| `agid_balance` | identity.ts:23-34 | false | identity |
| `agid_get_public_key` | identity.ts:37-64 | false | identity |
| `agid_get_height` | identity.ts:67-77 | false | identity |
| `agid_lookup_identity` | identity.ts:80-123 | false | identity |
| `agid_cert_issue` | certificates.ts:22-71 | true | identity |
| `agid_cert_receive` | certificates.ts:78-100+ | true | identity |
| `agid_cert_list` | certificates.ts | true | identity |
| `agid_cert_verify` | certificates.ts | false | identity |
| `agid_cert_revoke` | certificates.ts | true | identity |
| `agid_cert_reveal` | certificates.ts | true | identity |
| `agid_cert_check_revocation` | certificates.ts | false | identity |
| `agid_cert_send` | certificates.ts | true | identity |
| `agid_zkproof_privilege` | zkproof-ops.ts | true | identity |
| `agid_zkproof_verify` | zkproof-ops.ts | false | identity |
| `agid_zkproof_selective_reveal` | zkproof-ops.ts | true | identity |
| `agid_zkproof_commitment` | zkproof-ops.ts | true | identity |
| `agid_zkproof_verify_commitment` | zkproof-ops.ts | false | identity |

**Key details:**
- Identity tools (5): use `ctx.wallet.getPublicKey()`, `ctx.wallet.getNetwork()`, `ctx.wallet.getBalanceAndUtxos()`, `ctx.wallet.getHeight()`, `IdentityClient` from `@bsv/sdk`
- Certificate tools (8): use `PeerCert` from `peercert` package, initialized with `ctx.wallet.asWalletInterface()`
- ZK proof tools (5): use `PrivateKey`, `PublicKey`, `BigNumber`, `Schnorr`, `Point` from `@bsv/sdk` plus `lockPushDropToken` from `../../wallet/pushdrop-ops.js`
- The zkproof-ops.ts file has helper functions (`pointToHex`, `hexToPoint`, `validateCounterpartyKey`) that should be included in the plugin file
- This is a BIG file — consider splitting into 3 sub-files imported by the main plugin:
  - `src/plugins/builtin/identity/core.ts` — 5 identity tools
  - `src/plugins/builtin/identity/certificates.ts` — 8 cert tools
  - `src/plugins/builtin/identity/zkproof.ts` — 5 ZK tools + helpers
  - `src/plugins/builtin/agid-identity.ts` — imports and registers all

**Test assertions:**
- 18 tools registered
- All in group `identity`
- Correct requiresWallet flags per tool

### Task 3: agid-deploy Plugin (8 tools)

**Source file to read first:**
- `src/agent/tools/deployment.ts` — 8 tools (all use MandalaClient)

**Create:** `src/plugins/builtin/agid-deploy.ts`
**Test:** `src/__tests__/plugins/builtin/agid-deploy.test.ts`

**Tools to migrate:**

| Tool Name | Source | requiresWallet | Group |
|-----------|--------|---------------|-------|
| `agid_mandala_create_project` | deployment.ts:15-38 | true | deploy |
| `agid_mandala_list_projects` | deployment.ts:40-58 | true | deploy |
| `agid_mandala_project_info` | deployment.ts:60-79 | true | deploy |
| `agid_mandala_deploy` | deployment.ts:81-100 | true | deploy |
| `agid_mandala_update_settings` | deployment.ts:102-130 | true | deploy |
| `agid_mandala_project_logs` | deployment.ts:132-166 | true | deploy |
| `agid_mandala_manage_admins` | deployment.ts:168-207 | true | deploy |
| `agid_mandala_node_info` | deployment.ts:209-228 | false | deploy |

**Key details:**
- All tools use `new MandalaClient(ctx.wallet)` except `node_info` which uses `new MandalaClient(null as any)`
- Import: `MandalaClient` from `../../integrations/mandala/index.js`
- Adjust import path for builtin dir: `../../../integrations/mandala/index.js`

**Test assertions:**
- 8 tools registered
- All in group `deploy`
- All except node_info require wallet

### Task 4: Remove Deprecated Tools

Remove from `createAllTools()` in `src/agent/tools/index.ts`:
- `import { xResearchTools } from './x-research.js';`
- `import { calibrationTools } from './calibration.js';`
- `import { skillCreatorTools } from './skill-creator.js';`
- `...xResearchTools(),`
- `...calibrationTools(),`
- And their conditional blocks for `skillStore`

These tools are being dropped entirely (not migrated):
- 5 x-research tools (deferred)
- 4 calibration tools (removed — niche)
- 1 skill-creator tool (replaced by skills system)

### Task 5: Final Cleanup — Empty createAllTools()

After all migrations, `createAllTools()` should be empty or removed entirely. The function body should just return `[]` with a comment pointing to the plugin system:

```typescript
export function createAllTools(_ctx: ToolContext): ToolDescriptor[] {
  // All tools have been migrated to the plugin system.
  // See src/plugins/builtin/ for plugin definitions.
  // Use PluginRegistry.loadPlugin() to register tools.
  return [];
}
```

Update `src/plugins/builtin/index.ts` to export all 8 plugins.

---

## Plan 3: Sub-Project 3 — New Tools (exec, fs, browser = 7 tools)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add 3 new plugin packages for general-purpose agent capabilities matching OpenClaw.

**Architecture:** Each is a new plugin under `src/plugins/builtin/`. They're built as plugins from day one — no old-style tool code.

**Tech Stack:** TypeScript, vitest, Node child_process/PTY, Playwright

### Task 1: agid-runtime Plugin (2 tools: exec, process)

**Create:** `src/plugins/builtin/agid-runtime.ts`
**Test:** `src/__tests__/plugins/builtin/agid-runtime.test.ts`

**Reference:** OpenClaw's exec tool documentation at https://docs.openclaw.ai/tools/exec.md

**Tools:**

| Tool Name | Description | Parameters |
|-----------|-------------|------------|
| `exec` | Run a shell command | `command` (required), `workdir`, `env`, `timeout` (default 1800s), `background` |
| `process` | Manage background processes | `action` (poll/send-keys/submit/paste), `sessionId`, `keys`, `text` |

**Implementation details:**
- Use Node `child_process.spawn()` for foreground execution
- Background sessions: store `ChildProcess` references in a `Map<string, ChildProcess>` keyed by session ID
- `exec` with `background: true` returns immediately with `{ sessionId, status: 'running' }`
- `process` with `action: 'poll'` checks if the process is still running and returns buffered output
- `process` with `action: 'send-keys'` writes to stdin
- Timeout: kill process after `timeout` seconds (default 1800)
- Working directory: default to `process.cwd()`, override with `workdir`
- Environment: merge `env` params into `process.env`
- Security: This is a **full access** tool — no sandboxing (matches OpenClaw default). Controlled via `tools.deny` or profiles.

**Test assertions:**
- 2 tools registered
- Both in group `runtime`
- Neither requires wallet
- exec tool can run `echo hello` and return output (integration test)

### Task 2: agid-fs Plugin (4 tools: read, write, edit, apply_patch)

**Create:** `src/plugins/builtin/agid-fs.ts`
**Test:** `src/__tests__/plugins/builtin/agid-fs.test.ts`

**Tools:**

| Tool Name | Description | Parameters |
|-----------|-------------|------------|
| `read` | Read a file | `path` (required), `offset`, `limit` (line range) |
| `write` | Write/create a file | `path` (required), `content` (required) |
| `edit` | Replace text in a file | `path` (required), `old_string`, `new_string`, `replace_all` |
| `apply_patch` | Apply multi-hunk unified diff patch | `patch` (required), `path` |

**Implementation details:**
- All operations scoped to workspace directory (configurable, default `process.cwd()`)
- `read`: Use `fs.readFile()`, support line range with offset/limit
- `write`: Use `fs.writeFile()`, create parent directories with `mkdirp`
- `edit`: Read file, find `old_string`, replace with `new_string`. If not unique, fail with error.
- `apply_patch`: Parse unified diff format, apply hunks. Use a simple patch parser — don't import a heavy library.
- Path validation: reject paths that escape the workspace (no `../` traversal above workspace root)

**Test assertions:**
- 4 tools registered
- All in group `fs`
- None require wallet
- Integration tests: read/write/edit a temp file

### Task 3: agid-browser Plugin (1 tool: browser)

**Create:** `src/plugins/builtin/agid-browser.ts`
**Test:** `src/__tests__/plugins/builtin/agid-browser.test.ts`
**Dependency:** `npm install playwright` (add to package.json)

**Tools:**

| Tool Name | Description | Parameters |
|-----------|-------------|------------|
| `browser` | Control a headless Chromium browser | `action` (required: navigate/click/type/screenshot/evaluate/scroll/close), `url`, `selector`, `text`, `expression`, `direction`, `amount` |

**Implementation details:**
- Lazy Playwright initialization: `chromium.launch()` on first use, reuse the browser instance
- Actions:
  - `navigate`: `page.goto(url)`
  - `click`: `page.click(selector)`
  - `type`: `page.fill(selector, text)`
  - `screenshot`: `page.screenshot()` → return base64 encoded
  - `evaluate`: `page.evaluate(expression)` → return result
  - `scroll`: `page.evaluate(() => window.scrollBy(0, amount))`
  - `close`: close page (not browser)
- Single browser instance, multiple pages via page pool
- Cleanup in `destroy()`: close browser

**Test assertions:**
- 1 tool registered
- In group `browser`
- Does not require wallet
- Note: Full browser tests require Playwright chromium installed — mark as integration tests

### Task 4: Update Builtin Index

Update `src/plugins/builtin/index.ts` to export the 3 new plugins:
```typescript
export { agidRuntimePlugin } from './agid-runtime.js';
export { agidFsPlugin } from './agid-fs.js';
export { agidBrowserPlugin } from './agid-browser.js';
```

---

## Plan 4: Sub-Project 4 — OpenClaw Plugin Package

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Package all AGiD tools as an OpenClaw-compatible plugin with an embedded wallet.

**Architecture:** A separate npm package `@agid/openclaw-plugin` that imports all builtin plugin registration functions and runs them inside OpenClaw's runtime. The wallet is initialized lazily via `@bsv/wallet-toolbox`.

**Tech Stack:** TypeScript, @bsv/wallet-toolbox, openclaw plugin-sdk

### Task 1: Create Package Structure

Create a new directory `packages/openclaw-plugin/` with:

```
packages/openclaw-plugin/
├── package.json
├── openclaw.plugin.json
├── tsconfig.json
├── index.ts
└── src/
    └── wallet-init.ts
```

**package.json:**
```json
{
  "name": "@agid/openclaw-plugin",
  "version": "1.0.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "openclaw": {
    "extensions": ["./dist/index.js"]
  },
  "dependencies": {
    "@bsv/sdk": "^2.0.3",
    "@bsv/wallet-toolbox": "^2.0.19",
    "peercert": "^0.1.4"
  },
  "peerDependencies": {
    "openclaw": "*"
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

### Task 2: Implement Entry Point

**index.ts:**
- Import `definePluginEntry` from `openclaw/plugin-sdk/plugin-entry`
- Import registration functions from all 8 AGiD builtin plugins
- Lazy-initialize wallet via `@bsv/wallet-toolbox`
- Register all tools via `api.registerTool()`
- Implement `destroy()` for wallet cleanup

**Key design:**
- Each builtin plugin's `register(api)` function needs to be callable standalone — currently they're called within `definePluginEntry`. Refactor each plugin to export a `registerXTools(api, getWallet)` function in addition to the plugin entry.
- OR: the OpenClaw entry point re-creates the tools directly (duplicating the tool definitions). Less DRY but simpler to start.
- **Recommended:** Export `registerTools` functions from each builtin plugin for reuse.

### Task 3: Wallet Initialization

**src/wallet-init.ts:**
```typescript
import { WalletToolbox } from '@bsv/wallet-toolbox';

export async function initWallet(config: {
  storage: 'local' | 'cloud';
  network: 'mainnet' | 'testnet';
  storagePath: string;
}) {
  // Initialize wallet-toolbox with SQLite storage
  // Keys generated on first run
  // Returns wallet instance
}
```

This is the most implementation-specific part — depends on wallet-toolbox API for SQLite initialization.

### Task 4: Test & Publish

- Write tests verifying the plugin registers all expected tools
- Build: `tsc`
- Publish: `npm publish --access public`

---

## Execution Order

Run these plans in order:

1. **Batch B** (crypto + wallet) — 12 tools, 3 tasks
2. **Batch C** (memory + identity + deploy) — 30 tools, 5 tasks
3. **Sub-project 3** (exec, fs, browser) — 7 new tools, 4 tasks
4. **Sub-project 4** (OpenClaw package) — packaging, 4 tasks

After Batch B + C, `createAllTools()` returns `[]` and all tools are plugins. Sub-project 3 adds new capabilities. Sub-project 4 packages everything for OpenClaw.

## Current State of createAllTools() (after Batch A)

Still contains these tools (to be migrated/removed):
```
identityTools()        → Batch C Task 2 (agid-identity, 5 tools)
walletOpsTools()       → Batch B Task 1 (agid-crypto, 3 tools)
walletClientTools()    → Batch B Task 1 (agid-crypto, 2 tools)
transactionTools()     → Batch B Task 2 (agid-wallet, 4 tools)
tokenTools()           → Batch B Task 2 (agid-wallet, 3 tools)
xResearchTools()       → Batch C Task 4 (REMOVE)
deploymentTools()      → Batch C Task 3 (agid-deploy, 8 tools)
certTools()            → Batch C Task 2 (agid-identity, 8 tools)
calibrationTools()     → Batch C Task 4 (REMOVE)
zkproofTools()         → Batch C Task 2 (agid-identity, 5 tools)
memoryTools()          → Batch C Task 1 (agid-memory, 2 tools)
auditTools()           → Already migrated (Batch A)
shadTools()            → Batch C Task 1 (agid-memory, 2 tools)
skillCreatorTools()    → Batch C Task 4 (REMOVE)
```
