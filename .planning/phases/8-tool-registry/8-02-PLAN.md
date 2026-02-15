---
phase: 8-tool-registry
plan: 02
type: execute
---

<objective>
Create OpenClaw plugin that registers wallet and memory tools, calling AGIdentity gateway via HTTP.

Purpose: Enable OpenClaw AI agent to discover and execute wallet/memory operations through standardized AgentTool interface with TypeBox parameter validation.
Output: Working OpenClaw plugin in extensions/agidentity-tools/ with 4 tools registered, tested end-to-end.
</objective>

<execution_context>
~/.claude/get-shit-done/workflows/execute-phase.md
./summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/8-tool-registry/8-RESEARCH.md
@.planning/phases/8-tool-registry/8-INFRASTRUCTURE-ANALYSIS.md
@.planning/phases/8-tool-registry/8-01-SUMMARY.md

# Reference implementations:
@src/server/auth-server.ts
@src/client/agidentity-client.ts
@node_modules/openclaw/dist/plugin-sdk/index.d.ts
@node_modules/@sinclair/typebox/package.json

**Tech stack available:**
- OpenClaw Plugin SDK with OpenClawPluginApi
- @sinclair/typebox 0.34.48 for parameter schemas
- AGIDClient with BRC-103 authentication (reuse existing)
- AgentTool interface from @mariozechner/pi-agent-core

**Established patterns:**
- Plugin entry point: `export default function register(api: OpenClawPluginApi)`
- Tool registration: `api.registerTool(toolOrFactory, { names, optional })`
- TypeBox schemas: `Type.Object({ param: Type.String({ description }) })`
- Tool result: `{ content: [{ type: 'text', text }], details }`
- Plugin config: `api.pluginConfig as { gatewayUrl, authToken }`

**Constraining decisions:**
- Research: TypeBox schemas (not JSON Schema)
- Research: Mark wallet tools as optional (require allowlist)
- Research: Plugin calls AGIdentity gateway HTTP API
- Infrastructure: Use AGIDClient for BRC-103 authenticated requests

**From 8-01 (auth-server endpoints):**
- GET /wallet/balance returns { success, satoshis, utxoCount }
- POST /wallet/create-transaction returns { success, txHex, txid, size, fee }
- POST /memory/search returns { success, results, count, query }
- GET /memory/get/:path returns { success, path, content, length }
</context>

<tasks>

<task type="auto">
  <name>Task 1: Create plugin structure and API client</name>
  <files>extensions/agidentity-tools/package.json, extensions/agidentity-tools/index.ts, extensions/agidentity-tools/tsconfig.json, extensions/agidentity-tools/src/api-client.ts</files>
  <action>
    Create OpenClaw plugin directory structure:

    1. **Create extensions/agidentity-tools/package.json:**
       ```json
       {
         "name": "@agidentity/openclaw-plugin",
         "version": "1.0.0",
         "private": true,
         "description": "AGIdentity wallet and memory tools for OpenClaw",
         "type": "module",
         "main": "index.ts",
         "dependencies": {
           "@sinclair/typebox": "^0.34.48"
         },
         "openclaw": {
           "extensions": ["./index.ts"]
         }
       }
       ```

    2. **Create extensions/agidentity-tools/tsconfig.json:**
       Extend from root tsconfig.json, set module: "ESNext", target: "ES2022"

    3. **Create extensions/agidentity-tools/index.ts (plugin entry point):**
       - Import OpenClawPluginApi type
       - Export default function register(api: OpenClawPluginApi)
       - Get config: `const config = api.pluginConfig as { gatewayUrl?: string; authToken?: string } | undefined`
       - Default gatewayUrl: 'http://localhost:3000'
       - Log plugin registration with api.logger
       - Placeholder for tool registration (will be added in Tasks 2-3)

    4. **Create extensions/agidentity-tools/src/api-client.ts:**
       - Import AGIDClient, AgentWallet from 'agidentity'
       - Export function createPluginClient(config: { gatewayUrl: string })
       - For now, document that wallet will come from plugin context (defer auth until testing)
       - Export simplified fetch wrapper: `async function request(method, path, body?): Promise<any>`
       - Use fetch with { method, headers: { 'Content-Type': 'application/json' }, body? }
       - Parse JSON response, throw on !ok

    **AVOID:** Installing OpenClaw as dependency (it's provided by host). Don't create wallet in plugin (security risk). Keep client simple for now.
  </action>
  <verify>
    ls extensions/agidentity-tools/package.json exists. ls extensions/agidentity-tools/index.ts exists. grep "openclaw" extensions/agidentity-tools/package.json shows extensions field. TypeScript compiles without errors.
  </verify>
  <done>
    Plugin structure created with package.json, tsconfig.json, entry point, and API client wrapper. Ready for tool registration.
  </done>
</task>

<task type="auto">
  <name>Task 2: Create wallet tools with TypeBox schemas</name>
  <files>extensions/agidentity-tools/src/wallet-tools.ts, extensions/agidentity-tools/index.ts</files>
  <action>
    Create wallet tools following OpenClaw AgentTool interface:

    1. **Create extensions/agidentity-tools/src/wallet-tools.ts:**
       - Import Type from '@sinclair/typebox'
       - Import AnyAgentTool from 'openclaw/plugin-sdk'
       - Import request function from './api-client.js'

       Export function `createWalletTools(config: { gatewayUrl: string }): AnyAgentTool[]` returning array of 2 tools:

       **Tool 1: agid_get_balance**
       - name: 'agid_get_balance'
       - label: 'Get Wallet Balance'
       - description: "Get current BSV wallet balance in satoshis and UTXO count. Use this before creating transactions to ensure sufficient funds. Checks the agent's MPC-protected wallet balance."
       - parameters: `Type.Object({})` (no parameters)
       - async execute(toolCallId, params, signal):
         - Call `await request('GET', '/wallet/balance')`
         - Return `{ content: [{ type: 'text', text: \`Balance: ${data.satoshis} satoshis (${data.utxoCount} UTXOs)\` }], details: data }`

       **Tool 2: agid_create_transaction**
       - name: 'agid_create_transaction'
       - label: 'Create BSV Transaction'
       - description: "Create an unsigned BSV transaction to send satoshis. Returns transaction hex. This does NOT broadcast the transaction - it only creates it. The transaction must be signed and broadcast separately."
       - parameters: `Type.Object({ recipient: Type.String({ description: 'BSV address (P2PKH starting with 1)' }), satoshis: Type.Integer({ description: 'Amount in satoshis (1 BSV = 100,000,000 sats)' }), data: Type.Optional(Type.String({ description: 'Optional OP_RETURN data (hex, max 100KB)' })) })`
       - async execute(toolCallId, params, signal):
         - Call `await request('POST', '/wallet/create-transaction', params)`
         - Return formatted result with txid, size, fee

    2. **Update extensions/agidentity-tools/index.ts:**
       - Import createWalletTools from './src/wallet-tools.js'
       - In register(), call: `api.registerTool((ctx) => ctx.sandboxed ? null : createWalletTools({ gatewayUrl }), { names: ['agid_get_balance', 'agid_create_transaction'], optional: true })`
       - Use tool factory pattern to disable in sandbox mode
       - Mark optional: true (requires explicit allowlist for security)

    **AVOID:** Hardcoding gateway URL. Not checking sandbox mode. Forgetting TypeBox Type.Optional for optional params. Not marking wallet tools as optional.
  </action>
  <verify>
    ls extensions/agidentity-tools/src/wallet-tools.ts exists. grep "agid_get_balance" extensions/agidentity-tools/src/wallet-tools.ts shows tool. grep "Type.Object" shows TypeBox usage. TypeScript compiles.
  </verify>
  <done>
    Two wallet tools created with TypeBox parameter schemas. Tools registered in plugin entry point with sandbox detection and optional security flag. Ready for memory tools.
  </done>
</task>

<task type="auto">
  <name>Task 3: Create memory tools with TypeBox schemas</name>
  <files>extensions/agidentity-tools/src/memory-tools.ts, extensions/agidentity-tools/index.ts</files>
  <action>
    Create memory tools following OpenClaw AgentTool interface:

    1. **Create extensions/agidentity-tools/src/memory-tools.ts:**
       - Import Type from '@sinclair/typebox'
       - Import AnyAgentTool from 'openclaw/plugin-sdk'
       - Import request from './api-client.js'

       Export function `createMemoryTools(config: { gatewayUrl: string }): AnyAgentTool[]` returning array of 2 tools:

       **Tool 1: agid_store_memory**
       - name: 'agid_store_memory'
       - label: 'Store Memory'
       - description: "Store information in agent's long-term encrypted memory. Memories are stored on BSV blockchain via UHRP (encrypted). Use this to remember important information across conversations."
       - parameters: `Type.Object({ content: Type.String({ description: 'Information to remember' }), tags: Type.Optional(Type.Array(Type.String(), { description: 'Tags for categorization (e.g., ["meeting", "todo"])' })) })`
       - async execute(toolCallId, params, signal, onUpdate):
         - onUpdate optional progress: "Encrypting memory..."
         - Call `await request('POST', '/vault/store', { path: \`memory-${Date.now()}.md\`, content: params.content })`
         - Return success with path and uhrpUrl

       **Tool 2: agid_recall_memory**
       - name: 'agid_recall_memory'
       - label: 'Recall Memory'
       - description: "Search agent's long-term memory for relevant information. Returns most relevant memories based on semantic similarity. Use this to retrieve information from past conversations."
       - parameters: `Type.Object({ query: Type.String({ description: 'What to search for' }), limit: Type.Optional(Type.Integer({ description: 'Max results (default: 3, max: 10)' })) })`
       - async execute(toolCallId, params, signal):
         - Call `await request('POST', '/memory/search', { query: params.query, limit: params.limit ?? 3 })`
         - Format results as numbered list
         - Return `{ content: [{ type: 'text', text: formattedResults }], details: data }`

    2. **Update extensions/agidentity-tools/index.ts:**
       - Import createMemoryTools from './src/memory-tools.js'
       - In register(), call: `api.registerTool(createMemoryTools({ gatewayUrl }), { names: ['agid_store_memory', 'agid_recall_memory'], optional: false })`
       - Memory tools available by default (no sandbox restriction needed)

    3. **Add README.md** in extensions/agidentity-tools/:
       - Document installation: copy to OpenClaw's extensions/ directory
       - Document config in OpenClaw config.json5:
         ```json5
         {
           "plugins": {
             "agidentity-tools": {
               "gatewayUrl": "http://localhost:3000",
               "authToken": "optional-bearer-token"
             }
           }
         }
         ```
       - Document tool allowlist for wallet tools
       - List all 4 tools with descriptions

    **AVOID:** Forgetting streaming update callback (onUpdate) for store. Not providing default limit. Marking memory tools as optional (they're safe for general use).
  </action>
  <verify>
    ls extensions/agidentity-tools/src/memory-tools.ts exists. grep "agid_store_memory" shows tool. grep "agid_recall_memory" shows tool. ls extensions/agidentity-tools/README.md exists. TypeScript compiles without errors.
  </verify>
  <done>
    Two memory tools created with TypeBox schemas. Tools registered in plugin. README.md documents installation and configuration. Plugin complete with 4 tools total (2 wallet, 2 memory).
  </done>
</task>

</tasks>

<verification>
Before declaring plan complete:
- [ ] `npm run build` succeeds without errors
- [ ] All 4 tools have TypeBox parameter schemas
- [ ] Wallet tools marked optional: true, memory tools optional: false
- [ ] Plugin entry point exports register() function
- [ ] README.md documents installation and config
- [ ] No errors or warnings introduced
</verification>

<success_criteria>

- OpenClaw plugin structure created in extensions/agidentity-tools/
- package.json with openclaw.extensions field
- Plugin entry point (index.ts) with register() function
- API client wrapper for HTTP requests
- 2 wallet tools: agid_get_balance, agid_create_transaction
- 2 memory tools: agid_store_memory, agid_recall_memory
- All tools use TypeBox schemas for parameters
- Wallet tools marked as optional (security)
- README.md with installation/configuration docs
- TypeScript compiles without errors
- Phase 8 complete: Tool registry system operational
</success_criteria>

<output>
After completion, create `.planning/phases/8-tool-registry/8-02-SUMMARY.md`:

# Phase 8 Plan 2: Create OpenClaw Plugin with Tools Summary

**OpenClaw plugin provides wallet and memory tools to AI agent via standardized AgentTool interface**

## Accomplishments

- Created OpenClaw plugin structure in extensions/agidentity-tools/
- Implemented 2 wallet tools (get balance, create transaction) with TypeBox validation
- Implemented 2 memory tools (store, recall) with semantic search
- Plugin calls AGIdentity gateway HTTP API for all operations
- Comprehensive README.md with installation and configuration
- Phase 8 complete: Tool registry system enables OpenClaw to execute wallet/memory operations

## Files Created/Modified

- `extensions/agidentity-tools/package.json` - Plugin manifest
- `extensions/agidentity-tools/index.ts` - Plugin entry point with tool registration
- `extensions/agidentity-tools/tsconfig.json` - TypeScript config
- `extensions/agidentity-tools/src/api-client.ts` - HTTP client wrapper
- `extensions/agidentity-tools/src/wallet-tools.ts` - Wallet tool implementations
- `extensions/agidentity-tools/src/memory-tools.ts` - Memory tool implementations
- `extensions/agidentity-tools/README.md` - Installation and usage docs

## Decisions Made

[Key decisions and rationale, or "None"]

## Issues Encountered

[Problems and resolutions, or "None"]

## Next Step

Phase 8 complete. Ready for Phase 9 (Approval Workflow).
Manual testing: Install plugin in OpenClaw, configure gateway URL, test tool execution.
</output>
