---
phase: 7-memory-write-path
plan: 01
type: execute
---

<objective>
Implement autonomous memory write capability using PushDrop tokens and UHRP storage.

Purpose: Enable OpenClaw agent to write encrypted memories to blockchain-backed UHRP storage with cryptographic ownership proof via PushDrop tokens (BRC-48). Agent can autonomously create memories that are verifiably owned and retrievable.

Output: Working storeMemory function that encrypts content, uploads to UHRP via BSV SDK, creates PushDrop ownership token, and stores in wallet basket.
</objective>

<execution_context>
~/.claude/get-shit-done/workflows/execute-phase.md
./summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/7-memory-write-path/7-RESEARCH.md
@.planning/phases/06-agent-self-awareness/06-01-SUMMARY.md
@.planning/codebase/STACK.md
@.planning/codebase/ARCHITECTURE.md

**Phase 6 provided:**
- Identity tools (getIdentity, proveIdentity)
- Agent self-awareness via context injection
- AgentWallet with MPC protection

**Tech stack available:**
- @bsv/wallet-toolbox 2.0.14 - BRC-100 wallet with basket support
- AgentWallet - wallet.encrypt, wallet.createAction, wallet.getPublicKey

**From RESEARCH.md - CRITICAL patterns:**
- **Use PushDrop tokens** for ownership (NOT OP_RETURN)
- **Use @bsv/sdk storageUploader** (NOT custom UHRP client)
- **Always encrypt** before UHRP upload (privacy requirement)
- **Store in wallet basket** 'agent-memories' for retrieval

**Don't hand-roll from RESEARCH.md:**
- UHRP upload/download → Use @bsv/sdk storageUploader/Downloader
- PushDrop token creation → Use PushDrop template from @bsv/sdk
- Transaction building → Use wallet.createAction (handles UTXO, fees, signing)

**Existing components:**
@src/wallet/agent-wallet.ts
@src/tools/identity-tools.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Install @bsv/sdk and create memory module structure</name>
  <files>package.json, package-lock.json, src/memory/index.ts, src/memory/memory-types.ts</files>
  <action>
1. Install @bsv/sdk: `npm install @bsv/sdk`
2. Create src/memory/ directory for memory management
3. Create memory-types.ts with TypeScript interfaces:
   - MemoryInput: { content: string, tags: string[], importance: 'high' | 'medium' | 'low' }
   - MemoryToken: { txid: string, uhrpUrl: string, tags: string[], importance: string, createdAt: number }
4. Create index.ts barrel export

**What to avoid:**
- Do NOT create custom UHRP client classes (use @bsv/sdk utilities)
- Do NOT define OP_RETURN formats (use PushDrop tokens)
</action>
  <verify>
- `npm list @bsv/sdk` shows installed version
- TypeScript compiles without errors: `npm run build`
- src/memory/memory-types.ts exports MemoryInput and MemoryToken types
  </verify>
  <done>
- @bsv/sdk installed in package.json
- src/memory/ module created with types
- No TypeScript errors
  </done>
</task>

<task type="auto">
  <name>Task 2: Implement storeMemory with PushDrop tokenization</name>
  <files>src/memory/memory-writer.ts, src/memory/index.ts</files>
  <action>
Create storeMemory function following RESEARCH.md Pattern 1 exactly:

**Signature:**
```typescript
export async function storeMemory(
  wallet: AgentWallet,
  memory: MemoryInput
): Promise<MemoryToken>
```

**Implementation steps (from RESEARCH.md):**
1. **Encrypt content:**
   - Use wallet.encrypt with protocolID [2, 'agidentity-memory']
   - keyID: `memory-${Date.now()}`
   - Convert content to Uint8Array via TextEncoder

2. **Upload to UHRP:**
   - Import: `import { storageUploader } from '@bsv/sdk/storage'`
   - Call storageUploader({ data: new Uint8Array(encrypted.ciphertext) })
   - Returns uhrp:// URL

3. **Create PushDrop token:**
   - Import: `import { PushDrop } from '@bsv/sdk/script/templates'`
   - Get agent public key: wallet.getPublicKey({ identityKey: true })
   - Call wallet.createAction with:
     - outputs[0].lockingScript: new PushDrop().lock({
         fields: [uhrpUrl, memory.tags.join(','), memory.importance],
         ownerPublicKey: publicKey
       })
     - outputs[0].satoshis: 1 (minimum UTXO)
     - labels: ['agidentity-memory', memory.importance, ...memory.tags]
     - baskets: ['agent-memories']  // CRITICAL for retrieval

4. **Return MemoryToken** with txid, uhrpUrl, tags, importance, createdAt

**What to avoid:**
- Do NOT use OP_RETURN (creates unspendable output, no ownership proof)
- Do NOT build transactions manually (wallet.createAction handles UTXO/fees)
- Do NOT skip basket assignment (agent won't be able to find memories)
- Do NOT upload plaintext to UHRP (always encrypt first)

Export from src/memory/index.ts.
  </action>
  <verify>
- TypeScript compiles: `npm run build`
- storeMemory function exported from src/memory/index.ts
- Code inspection: Uses PushDrop.lock() with fields array
- Code inspection: Uses storageUploader from @bsv/sdk/storage
- Code inspection: Includes baskets: ['agent-memories']
  </verify>
  <done>
- storeMemory function implemented following RESEARCH.md pattern
- Uses PushDrop tokens (NOT OP_RETURN)
- Uses BSV SDK storageUploader (NOT custom)
- Stores tokens in 'agent-memories' basket
- All content encrypted before upload
- No TypeScript errors
  </done>
</task>

</tasks>

<verification>
Before declaring plan complete:
- [ ] `npm run build` succeeds without errors
- [ ] @bsv/sdk installed and importable
- [ ] src/memory/ module structure created
- [ ] storeMemory function uses PushDrop.lock() (not OP_RETURN)
- [ ] storeMemory function uses storageUploader from @bsv/sdk
- [ ] Tokens stored in 'agent-memories' basket
- [ ] All imports resolve correctly
</verification>

<success_criteria>
- All tasks completed
- All verification checks pass
- No TypeScript errors introduced
- Memory write path implements PushDrop + UHRP pattern from RESEARCH.md
- Agent can create ownership tokens for memories
- Tokens stored in wallet basket for Phase 7 Plan 2 retrieval
</success_criteria>

<output>
After completion, create `.planning/phases/7-memory-write-path/7-01-SUMMARY.md`:

# Phase 7 Plan 1: Memory Write & Tokenization Summary

**[Substantive one-liner - what shipped]**

## Accomplishments

- Installed @bsv/sdk for PushDrop and UHRP operations
- Created memory module with TypeScript types
- Implemented storeMemory with encryption → UHRP upload → PushDrop token
- Agent can autonomously write memories with cryptographic ownership proof

## Files Created/Modified

- `package.json` - Added @bsv/sdk dependency
- `src/memory/memory-types.ts` - MemoryInput, MemoryToken types
- `src/memory/memory-writer.ts` - storeMemory function
- `src/memory/index.ts` - Module exports

## Decisions Made

- Used PushDrop tokens (BRC-48) for ownership proof, not OP_RETURN
- Basket name: 'agent-memories' for consistent retrieval
- protocolID: [2, 'agidentity-memory'] for encryption
- Token fields: [uhrpUrl, tags, importance]

## Issues Encountered

[Document any issues, or "None"]

## Next Step

Ready for 7-02-PLAN.md (Memory Retrieval & Lifecycle)
</output>
