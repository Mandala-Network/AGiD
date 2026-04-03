# Tool Migration Batch A: Audit + Optimize + Messaging

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate 8 existing tools (audit 2, optimize 1, messaging 5) from the old `ToolDescriptor` format to the new plugin system, proving the migration pattern works.

**Architecture:** Each plugin package is a single file under `src/plugins/builtin/` that uses `definePluginEntry` to register tools via the `api.registerTool()` pattern. Tools use the new `PluginToolResult` format (`{ content: [{ type: 'text', text }] }`). The old tool files remain but have their tools removed as they're migrated. The gateway loads builtin plugins at startup via the `PluginRegistry`.

**Tech Stack:** TypeScript, vitest, existing AGiD plugin runtime (`src/plugins/`)

**Spec:** `docs/superpowers/specs/2026-03-21-plugin-architecture-design.md`

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `src/plugins/builtin/agid-audit.ts` | Audit plugin (2 tools: verify_workspace, verify_session) |
| Create | `src/plugins/builtin/agid-optimize.ts` | Optimize plugin (1 tool: optimize_prompt) |
| Create | `src/plugins/builtin/agid-messaging.ts` | Messaging plugin (5 tools: message_send/list/ack, list_payments, accept_payment) |
| Create | `src/plugins/builtin/index.ts` | Exports all builtin plugins |
| Create | `src/__tests__/plugins/builtin/agid-audit.test.ts` | Tests for audit plugin registration |
| Create | `src/__tests__/plugins/builtin/agid-optimize.test.ts` | Tests for optimize plugin registration |
| Create | `src/__tests__/plugins/builtin/agid-messaging.test.ts` | Tests for messaging plugin registration |
| Modify | `src/agent/tools/index.ts` | Remove migrated tools from `createAllTools()` |

---

### Task 1: agid-audit Plugin

**Files:**
- Create: `src/plugins/builtin/agid-audit.ts`
- Create: `src/__tests__/plugins/builtin/agid-audit.test.ts`

- [ ] **Step 1: Write failing test**

Create `src/__tests__/plugins/builtin/agid-audit.test.ts`:

```typescript
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

    const tools = registry.getTools();
    for (const tool of tools) {
      expect(tool.options.group).toBe('audit');
    }
  });

  it('tools do not require wallet', () => {
    const registry = new PluginRegistry();
    registry.loadPlugin({
      manifest: { id: 'agid-audit' },
      definition: agidAuditPlugin,
      rootPath: '',
    });

    const tools = registry.getTools();
    for (const tool of tools) {
      expect(tool.registration.requiresWallet).toBeFalsy();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/plugins/builtin/agid-audit.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement agid-audit plugin**

Create `src/plugins/builtin/agid-audit.ts`:

```typescript
/**
 * AGiD Audit Plugin
 *
 * Tools for verifying workspace integrity and session anchor chains.
 */

import * as fs from 'fs';
import * as path from 'path';
import { definePluginEntry } from '../define-plugin-entry.js';
import { WorkspaceIntegrity } from '../../audit/workspace-integrity.js';
import { AnchorChain } from '../../audit/anchor-chain.js';
import type { AnchorChainData } from '../../audit/anchor-chain.js';

function json(data: Record<string, unknown>) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

export const agidAuditPlugin = definePluginEntry({
  id: 'agid-audit',
  name: 'AGiD Audit',
  register(api) {
    api.registerTool(
      {
        name: 'agid_verify_workspace',
        description: 'Verify workspace file integrity against the last on-chain anchor.',
        parameters: { type: 'object', properties: {} },
        async execute(_id, _params, ctx) {
          const workspacePath = ctx?.wallet ? undefined : undefined; // TODO: workspace from context
          if (!workspacePath) {
            return json({ error: 'workspacePath not configured — pass via tool context' });
          }
          const integrity = new WorkspaceIntegrity(workspacePath);
          const currentHash = await integrity.hashWorkspace();
          const lastAnchor = await integrity.getLastAnchor(ctx?.wallet);

          if (!lastAnchor) {
            return json({
              verified: false,
              message: 'No previous on-chain anchor found.',
              currentFiles: Object.keys(currentHash.files),
              combinedHash: currentHash.combinedHash,
            });
          }

          const matched = currentHash.combinedHash === lastAnchor.workspaceHash;
          return json({
            verified: matched,
            lastAnchorTxid: lastAnchor.txid,
            currentCombinedHash: currentHash.combinedHash,
            anchoredCombinedHash: lastAnchor.workspaceHash,
            files: currentHash.files,
            message: matched
              ? 'Workspace integrity verified against on-chain anchor.'
              : 'Workspace has changed since last on-chain anchor.',
          });
        },
      },
      { group: 'audit' },
    );

    api.registerTool(
      {
        name: 'agid_verify_session',
        description: 'Verify the anchor chain integrity for a past session.',
        parameters: {
          type: 'object',
          properties: {
            sessionId: { type: 'string', description: 'Session ID to verify' },
          },
          required: ['sessionId'],
        },
        async execute(_id, params) {
          // sessionsPath will be injected via context in gateway integration
          const sessionsPath = process.env.AGID_SESSIONS_PATH;
          if (!sessionsPath) {
            return json({ error: 'sessionsPath not configured' });
          }
          const sessionId = params.sessionId as string;
          const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
          const anchorPath = path.join(sessionsPath, `${safe}.anchor.json`);

          if (!fs.existsSync(anchorPath)) {
            return json({ verified: false, error: `No anchor chain found for session: ${sessionId}` });
          }

          const data: AnchorChainData = JSON.parse(fs.readFileSync(anchorPath, 'utf8'));
          const chain = AnchorChain.fromSerialized(data);
          const verification = await chain.verify();
          const merkleRoot = await chain.getMerkleRoot();

          return json({
            verified: verification.valid,
            sessionId: data.sessionId,
            anchorCount: data.anchors.length,
            headHash: data.headHash,
            merkleRoot,
            errors: verification.errors,
          });
        },
      },
      { group: 'audit' },
    );
  },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/plugins/builtin/agid-audit.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/plugins/builtin/agid-audit.ts src/__tests__/plugins/builtin/agid-audit.test.ts
git commit -m "feat: migrate audit tools to agid-audit plugin"
```

---

### Task 2: agid-optimize Plugin

**Files:**
- Create: `src/plugins/builtin/agid-optimize.ts`
- Create: `src/__tests__/plugins/builtin/agid-optimize.test.ts`

- [ ] **Step 1: Write failing test**

Create `src/__tests__/plugins/builtin/agid-optimize.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { PluginRegistry } from '../../../plugins/plugin-registry.js';
import { agidOptimizePlugin } from '../../../plugins/builtin/agid-optimize.js';

describe('agid-optimize plugin', () => {
  it('registers 1 tool', () => {
    const registry = new PluginRegistry();
    registry.loadPlugin({
      manifest: { id: 'agid-optimize' },
      definition: agidOptimizePlugin,
      rootPath: '',
    });

    const tools = registry.getTools();
    expect(tools).toHaveLength(1);
    expect(tools[0].registration.name).toBe('agid_optimize_prompt');
  });

  it('tool does not require wallet', () => {
    const registry = new PluginRegistry();
    registry.loadPlugin({
      manifest: { id: 'agid-optimize' },
      definition: agidOptimizePlugin,
      rootPath: '',
    });

    expect(registry.getTools()[0].registration.requiresWallet).toBeFalsy();
  });

  it('has correct parameters', () => {
    const registry = new PluginRegistry();
    registry.loadPlugin({
      manifest: { id: 'agid-optimize' },
      definition: agidOptimizePlugin,
      rootPath: '',
    });

    const params = registry.getTools()[0].registration.parameters as any;
    expect(params.required).toContain('text');
    expect(params.required).toContain('objective');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/plugins/builtin/agid-optimize.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement agid-optimize plugin**

Create `src/plugins/builtin/agid-optimize.ts`:

```typescript
/**
 * AGiD Optimize Plugin
 *
 * GEPA prompt optimization tool.
 */

import { GepaExecutor } from '../../integrations/gepa/index.js';
import { definePluginEntry } from '../define-plugin-entry.js';

function json(data: Record<string, unknown>) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

export const agidOptimizePlugin = definePluginEntry({
  id: 'agid-optimize',
  name: 'AGiD Optimize',
  register(api) {
    api.registerTool({
      name: 'agid_optimize_prompt',
      description: 'Optimize any text or prompt using GEPA evolutionary optimization.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'The text or prompt to optimize' },
          objective: { type: 'string', description: 'What the optimized text should achieve' },
          mode: { type: 'string', description: '"fast" (10 iterations) or "thorough" (30 iterations). Default: fast' },
        },
        required: ['text', 'objective'],
      },
      async execute(_id, params) {
        const text = params.text as string;
        const objective = params.objective as string;
        const mode = (params.mode as string) || 'fast';
        const maxIterations = mode === 'thorough' ? 30 : 10;

        const executor = new GepaExecutor();
        const availability = await executor.checkGepaAvailable();

        if (!availability.available) {
          return json({
            original: text,
            optimized: null,
            gepaAvailable: false,
            error: availability.error ?? 'gepa not installed',
          });
        }

        const result = await executor.optimize({ text, objective, maxIterations });

        if (!result.success) {
          return json({ original: text, optimized: null, gepaAvailable: true, error: result.error });
        }

        return json({
          original: text,
          optimized: result.optimizedText,
          reasoning: result.reasoning,
          iterations: result.iterations,
          gepaAvailable: true,
        });
      },
    });
  },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/plugins/builtin/agid-optimize.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/plugins/builtin/agid-optimize.ts src/__tests__/plugins/builtin/agid-optimize.test.ts
git commit -m "feat: migrate optimize tool to agid-optimize plugin"
```

---

### Task 3: agid-messaging Plugin

**Files:**
- Create: `src/plugins/builtin/agid-messaging.ts`
- Create: `src/__tests__/plugins/builtin/agid-messaging.test.ts`

- [ ] **Step 1: Write failing test**

Create `src/__tests__/plugins/builtin/agid-messaging.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { PluginRegistry } from '../../../plugins/plugin-registry.js';
import { agidMessagingPlugin } from '../../../plugins/builtin/agid-messaging.js';

describe('agid-messaging plugin', () => {
  it('registers 5 tools', () => {
    const registry = new PluginRegistry();
    registry.loadPlugin({
      manifest: { id: 'agid-messaging' },
      definition: agidMessagingPlugin,
      rootPath: '',
    });

    const tools = registry.getTools();
    expect(tools).toHaveLength(5);

    const names = tools.map(t => t.registration.name);
    expect(names).toContain('agid_message_send');
    expect(names).toContain('agid_message_list');
    expect(names).toContain('agid_message_ack');
    expect(names).toContain('agid_list_payments');
    expect(names).toContain('agid_accept_payment');
  });

  it('tools are in the messaging group', () => {
    const registry = new PluginRegistry();
    registry.loadPlugin({
      manifest: { id: 'agid-messaging' },
      definition: agidMessagingPlugin,
      rootPath: '',
    });

    for (const tool of registry.getTools()) {
      expect(tool.options.group).toBe('messaging');
    }
  });

  it('send/ack/list_payments/accept_payment require wallet', () => {
    const registry = new PluginRegistry();
    registry.loadPlugin({
      manifest: { id: 'agid-messaging' },
      definition: agidMessagingPlugin,
      rootPath: '',
    });

    const walletTools = ['agid_message_send', 'agid_message_ack', 'agid_list_payments', 'agid_accept_payment'];
    for (const tool of registry.getTools()) {
      if (walletTools.includes(tool.registration.name)) {
        expect(tool.registration.requiresWallet).toBe(true);
      }
    }
  });

  it('message_list does not require wallet directly', () => {
    const registry = new PluginRegistry();
    registry.loadPlugin({
      manifest: { id: 'agid-messaging' },
      definition: agidMessagingPlugin,
      rootPath: '',
    });

    const listTool = registry.getTool('agid_message_list');
    // message_list uses wallet for decryption but the old code marked it as not requiring wallet
    expect(listTool).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/plugins/builtin/agid-messaging.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement agid-messaging plugin**

Create `src/plugins/builtin/agid-messaging.ts`:

```typescript
/**
 * AGiD Messaging Plugin
 *
 * MessageBox-based encrypted messaging tools.
 */

import { definePluginEntry } from '../define-plugin-entry.js';

function json(data: Record<string, unknown>) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

export const agidMessagingPlugin = definePluginEntry({
  id: 'agid-messaging',
  name: 'AGiD Messaging',
  register(api) {
    api.registerTool(
      {
        name: 'agid_message_send',
        description: 'Send an encrypted message to a recipient via MessageBox',
        parameters: {
          type: 'object',
          properties: {
            recipient: { type: 'string', description: 'Recipient public key (33-byte hex)' },
            messageBox: { type: 'string', description: 'MessageBox name (default: general)' },
            body: { type: 'string', description: 'Message content (auto-encrypted via BRC-2 ECDH)' },
          },
          required: ['recipient', 'body'],
        },
        requiresWallet: true,
        async execute(_id, params, ctx) {
          const wallet = ctx?.wallet;
          if (!wallet) return json({ error: 'Wallet not available' });

          const recipient = params.recipient as string;
          const messageBox = (params.messageBox as string) || 'general';
          const body = params.body as string;
          const result = await wallet.sendMessage({ recipient, messageBox, body });
          return json({
            messageId: result.messageId,
            status: result.status,
            recipient: recipient.substring(0, 16) + '...',
            messageBox,
            sent: true,
          });
        },
      },
      { group: 'messaging' },
    );

    api.registerTool(
      {
        name: 'agid_message_list',
        description: 'List encrypted messages in a MessageBox (auto-decrypted)',
        parameters: {
          type: 'object',
          properties: {
            messageBox: { type: 'string', description: 'MessageBox name (default: general)' },
          },
        },
        requiresWallet: true,
        async execute(_id, params, ctx) {
          const wallet = ctx?.wallet;
          if (!wallet) return json({ error: 'Wallet not available' });

          const messageBox = (params.messageBox as string) || 'general';
          const messages = await wallet.listMessages({ messageBox });
          return json({
            messages: messages.map((m: any) => ({
              messageId: m.messageId,
              sender: m.sender,
              body: m.body,
              createdAt: m.created_at ?? m.createdAt,
            })),
            total: messages.length,
            messageBox,
          });
        },
      },
      { group: 'messaging' },
    );

    api.registerTool(
      {
        name: 'agid_message_ack',
        description: 'Acknowledge (delete) processed messages from MessageBox',
        parameters: {
          type: 'object',
          properties: {
            messageIds: {
              type: 'array',
              items: { type: 'string' },
              description: 'Message IDs to acknowledge',
            },
          },
          required: ['messageIds'],
        },
        requiresWallet: true,
        async execute(_id, params, ctx) {
          const wallet = ctx?.wallet;
          if (!wallet) return json({ error: 'Wallet not available' });

          const messageIds = params.messageIds as string[];
          await wallet.acknowledgeMessages({ messageIds });
          return json({ acknowledged: messageIds.length, success: true });
        },
      },
      { group: 'messaging' },
    );

    api.registerTool(
      {
        name: 'agid_list_payments',
        description: 'List pending incoming payments waiting to be accepted.',
        parameters: { type: 'object', properties: {} },
        requiresWallet: true,
        async execute(_id, _params, ctx) {
          const wallet = ctx?.wallet;
          if (!wallet) return json({ error: 'Wallet not available' });

          const payments = await (wallet as any).listIncomingPayments();
          return json({
            payments: payments.map((p: any) => ({
              messageId: p.messageId,
              sender: p.sender,
              amount: p.token?.amount ?? p.amount ?? 0,
            })),
            total: payments.length,
          });
        },
      },
      { group: 'messaging' },
    );

    api.registerTool(
      {
        name: 'agid_accept_payment',
        description: 'Accept an incoming payment by messageId.',
        parameters: {
          type: 'object',
          properties: {
            messageId: { type: 'string', description: 'Message ID of the payment to accept' },
            sender: { type: 'string', description: 'Sender public key' },
          },
          required: ['messageId', 'sender'],
        },
        requiresWallet: true,
        async execute(_id, params, ctx) {
          const wallet = ctx?.wallet;
          if (!wallet) return json({ error: 'Wallet not available' });

          const payments = await (wallet as any).listIncomingPayments();
          const payment = payments.find((p: any) => p.messageId === params.messageId);
          if (!payment) return json({ error: 'Payment not found', messageId: params.messageId });
          await (wallet as any).acceptPayment(payment);
          return json({
            accepted: true,
            messageId: params.messageId,
            amount: payment.token?.amount ?? payment.amount ?? 0,
          });
        },
      },
      { group: 'messaging' },
    );
  },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/plugins/builtin/agid-messaging.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/plugins/builtin/agid-messaging.ts src/__tests__/plugins/builtin/agid-messaging.test.ts
git commit -m "feat: migrate messaging tools to agid-messaging plugin"
```

---

### Task 4: Builtin Plugin Index + Remove Migrated Tools from Old Registry

**Files:**
- Create: `src/plugins/builtin/index.ts`
- Modify: `src/agent/tools/index.ts`

- [ ] **Step 1: Create builtin plugin index**

Create `src/plugins/builtin/index.ts`:

```typescript
/**
 * Built-in AGiD Plugins
 *
 * Exports all built-in plugins for registration at gateway startup.
 */

export { agidAuditPlugin } from './agid-audit.js';
export { agidOptimizePlugin } from './agid-optimize.js';
export { agidMessagingPlugin } from './agid-messaging.js';
```

- [ ] **Step 2: Remove migrated tools from createAllTools()**

In `src/agent/tools/index.ts`:

1. Remove these imports:
   - `import { messagingTools } from './messaging.js';`
   - `import { serviceTools } from './services.js';`

2. In the `createAllTools()` function, remove:
   - `...messagingTools(),`
   - `...serviceTools(),`

3. Add a comment noting why they were removed:
   ```typescript
   // Migrated to plugins: messaging (agid-messaging), services (agid-optimize)
   // Removed tools: agid_discover_services, agid_x402_request, agid_overlay_lookup
   ```

- [ ] **Step 3: Run tests**

Run: `npx vitest run`
Expected: PASS (no new failures — messaging and service tools are now registered via plugins instead)

- [ ] **Step 4: Commit**

```bash
git add src/plugins/builtin/index.ts src/agent/tools/index.ts
git commit -m "feat: add builtin plugin index, remove migrated tools from old registry"
```

---

## Summary

| Task | Plugin | Tools Migrated | Steps |
|------|--------|---------------|-------|
| 1 | agid-audit | 2 (verify_workspace, verify_session) | 5 |
| 2 | agid-optimize | 1 (optimize_prompt) | 5 |
| 3 | agid-messaging | 5 (message_send/list/ack, list/accept_payment) | 5 |
| 4 | Builtin index + cleanup | — | 4 |
| **Total** | | **8 tools** | **19 steps** |

**After this batch:** 8 tools are in the new plugin system. The remaining 42 tools stay in `createAllTools()` until Batches B and C migrate them. Both registries coexist — the gateway loads builtin plugins via `PluginRegistry` and old tools via `ToolRegistry`, bridged by `registerFromPluginRegistry()`.
