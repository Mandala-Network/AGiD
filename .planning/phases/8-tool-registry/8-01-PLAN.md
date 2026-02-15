---
phase: 8-tool-registry
plan: 01
type: execute
---

<objective>
Extend existing AGIdentity auth-server with wallet and memory endpoints for OpenClaw plugin integration.

Purpose: Expose wallet and memory operations via HTTP API so OpenClaw plugin can call them. Reuses existing Express server, BRC-103 auth, and session management (95% code reuse).
Output: auth-server.ts with new /wallet/* and /memory/* endpoints, ready for plugin consumption.
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
@.planning/phases/7-memory-write-path/7-02-SUMMARY.md

# Existing infrastructure to extend:
@src/server/auth-server.ts
@src/server/index.ts
@src/memory/agidentity-memory-server.ts
@src/wallet/agent-wallet.ts

**Tech stack available:**
- Express 5.0.0 with BRC-103/104 auth middleware (existing)
- AGIdentityMemoryServer with MCP-compatible methods (existing)
- AgentWallet with getBalance, createTransaction, createSignature (existing)
- Session tracking via activeSessions Map (existing)

**Established patterns:**
- All endpoints use `getClientKey(req)` for BRC-103 auth
- Session validation via `activeSessions.get(clientKey)`
- `updateSession(clientKey)` after successful operations
- Structured responses: `{ success: true/false, data, error }`

**Constraining decisions:**
- Phase 7: Memory server has memory_search, memory_get methods returning MCPToolResponse
- Infrastructure analysis: Extend auth-server.ts (don't create new server)
- Research: Plugin uses AGIDClient with BRC-103 auth

**Issues being addressed:**
None - clean implementation of new endpoints
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add wallet endpoints to auth-server</name>
  <files>src/server/auth-server.ts</files>
  <action>
    Add wallet endpoint section after existing signature endpoints, before health endpoints:

    1. **GET /wallet/balance** - Get wallet balance and UTXOs
       - Extract clientKey from auth
       - Call `config.wallet.getBalance()`
       - Return `{ success: true, satoshis, utxoCount }`
       - Use existing error handling pattern

    2. **POST /wallet/create-transaction** - Create unsigned transaction
       - Extract clientKey, validate { recipient, satoshis, data? } from req.body
       - Validate recipient exists, satoshis > 0
       - Call `config.wallet.createTransaction({ outputs: [{ to, satoshis, data }] })`
       - Return `{ success: true, txHex, txid, size, fee }`
       - Errors: 400 for missing params, 500 for wallet errors

    3. **POST /wallet/sign-message** - Sign arbitrary message
       - Extract clientKey, validate { message, keyId? } from req.body
       - Call `config.wallet.createSignature()` with protocolID [2, 'agidentity-plugin-sign']
       - Convert signature to hex string (same pattern as /sign endpoint)
       - Return `{ success: true, signature, signerPublicKey }`

    4. **GET /wallet/network** - Get current network (mainnet/testnet)
       - Extract clientKey
       - Call `config.wallet.getNetwork()`
       - Return `{ success: true, network }`

    Follow existing patterns: getClientKey, 401 if not authenticated, updateSession on success, consistent error handling.

    **AVOID:** Creating new server - extend existing. Don't skip auth validation. Don't forget updateSession.
  </action>
  <verify>
    TypeScript compiles without errors. grep "GET /wallet/balance" src/server/auth-server.ts shows endpoint exists. grep "POST /wallet/create-transaction" shows endpoint exists.
  </verify>
  <done>
    Four wallet endpoints added to auth-server.ts following existing patterns. All endpoints require BRC-103 auth, validate params, handle errors, update sessions.
  </done>
</task>

<task type="auto">
  <name>Task 2: Add memory endpoints to auth-server</name>
  <files>src/server/auth-server.ts</files>
  <action>
    Add memory endpoint section after wallet endpoints, before health endpoints:

    1. **POST /memory/search** - Search agent's long-term memory
       - Extract clientKey, validate { query, limit? } from req.body
       - Check `config.memoryServer` exists (return 503 if not configured)
       - Call `config.memoryServer.memory_search(query, limit ?? 10)`
       - Parse MCPToolResponse: `JSON.parse(response.content[0].text)`
       - Return `{ success: true, results: [...], count, query }`
       - Errors: 400 for missing query, 503 if memoryServer not configured

    2. **GET /memory/get/:path(*)** - Retrieve specific memory by path
       - Extract clientKey and path from req.params
       - Check `config.memoryServer` exists (return 503 if not configured)
       - Call `config.memoryServer.memory_get(getParam(req.params.path))`
       - Parse MCPToolResponse: `JSON.parse(response.content[0].text)`
       - If data.error, return 404
       - Return `{ success: true, path, content, length }`
       - Use `getParam()` helper for Express 5 compatibility (same as vault endpoints)

    3. **Update AGIDServerConfig interface** - Add optional memoryServer
       - Add `memoryServer?: AGIdentityMemoryServer;` to interface
       - Import AGIdentityMemoryServer type at top of file

    Follow existing patterns: getClientKey, updateSession, error handling, Express 5 param handling.

    **AVOID:** Calling memory methods without checking memoryServer exists. Forgetting to parse MCPToolResponse JSON. Not using getParam() for path parameter.
  </action>
  <verify>
    TypeScript compiles without errors. grep "POST /memory/search" src/server/auth-server.ts shows endpoint. grep "memoryServer?: AGIdentityMemoryServer" shows config updated. No type errors.
  </verify>
  <done>
    Two memory endpoints added to auth-server.ts. AGIDServerConfig interface updated with optional memoryServer. All endpoints follow existing patterns with proper auth, validation, and error handling.
  </done>
</task>

</tasks>

<verification>
Before declaring plan complete:
- [ ] `npm run build` succeeds without errors
- [ ] `npm run typecheck` passes (if script exists)
- [ ] All new endpoints follow existing auth-server patterns
- [ ] No linting errors introduced
</verification>

<success_criteria>

- auth-server.ts extended with 4 wallet endpoints and 2 memory endpoints
- AGIDServerConfig interface includes optional memoryServer field
- All endpoints use BRC-103 auth via getClientKey
- All endpoints update session tracking via updateSession
- Structured error handling matches existing patterns
- TypeScript compiles without errors
- No new dependencies added (100% code reuse)
</success_criteria>

<output>
After completion, create `.planning/phases/8-tool-registry/8-01-SUMMARY.md`:

# Phase 8 Plan 1: Extend Auth Server with Tool Endpoints Summary

**AGIdentity HTTP API now exposes wallet and memory operations for OpenClaw plugin integration**

## Accomplishments

- Extended auth-server.ts with 4 wallet endpoints (balance, create-transaction, sign-message, network)
- Added 2 memory endpoints (search, get by path)
- Updated AGIDServerConfig to support optional memory server
- 100% code reuse - no new dependencies, leveraged existing BRC-103 auth and session management

## Files Created/Modified

- `src/server/auth-server.ts` - Added wallet and memory endpoint sections

## Decisions Made

[Key decisions and rationale, or "None"]

## Issues Encountered

[Problems and resolutions, or "None"]

## Next Step

Ready for 8-02-PLAN.md (Create OpenClaw Plugin with Tools)
</output>
