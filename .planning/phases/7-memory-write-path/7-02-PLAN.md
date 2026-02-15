---
phase: 7-memory-write-path
plan: 02
type: execute
---

<objective>
Implement memory retrieval from wallet basket and garbage collection for lifecycle management.

Purpose: Enable agent to list/search its owned memories by querying the wallet basket, downloading from UHRP, and decrypting. Implement retention policies to automatically clean up old memories by spending their tokens.

Output: Working listMemories function for basket-based retrieval and applyGarbageCollection function for lifecycle management based on importance levels.
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
@.planning/phases/7-memory-write-path/7-01-SUMMARY.md
@.planning/codebase/STACK.md

**Plan 1 provided:**
- @bsv/sdk installed with PushDrop and storage utilities
- storeMemory function creating PushDrop tokens in 'agent-memories' basket
- MemoryInput and MemoryToken types

**From RESEARCH.md - Basket retrieval pattern:**
- Query wallet.listOutputs({ basket: 'agent-memories', spendable: true })
- Extract UHRP URL from PushDrop.fromScript(token.lockingScript).fields[0]
- Download via storageDownloader({ uhrpUrl })
- Decrypt with wallet.decrypt using protocolID [2, 'agidentity-memory']

**From RESEARCH.md - GC pattern:**
- Retention policy: high=3 years, medium=1 year, low=90 days
- Spend old tokens using wallet.createAction (removes from basket)
- UHRP files expire independently (provider handles)

**Existing components:**
@src/memory/memory-writer.ts
@src/memory/memory-types.ts
@src/wallet/agent-wallet.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Implement listMemories with basket query and UHRP retrieval</name>
  <files>src/memory/memory-reader.ts, src/memory/index.ts</files>
  <action>
Create listMemories function following RESEARCH.md Pattern 2:

**Signature:**
```typescript
interface Memory {
  txid: string;
  uhrpUrl: string;
  content: string;
  tags: string[];
  importance: string;
  createdAt: number;
}

export async function listMemories(
  wallet: AgentWallet,
  options?: { tags?: string[]; importance?: string }
): Promise<Memory[]>
```

**Implementation steps (from RESEARCH.md):**
1. **Query basket for memory tokens:**
   - Call wallet.listOutputs({
       basket: 'agent-memories',
       labels: options?.tags ? ['agidentity-memory', ...options.tags] : ['agidentity-memory'],
       spendable: true  // Only unspent (current) memories
     })

2. **Extract UHRP URLs from PushDrop fields:**
   - Import: `import { PushDrop } from '@bsv/sdk/script/templates'`
   - For each token: `const pushDrop = PushDrop.fromScript(token.lockingScript)`
   - Extract fields: `const [uhrpUrl, tagsStr, importance] = pushDrop.fields`

3. **Download and decrypt from UHRP:**
   - Import: `import { storageDownloader } from '@bsv/sdk/storage'`
   - Download: `const encryptedData = await storageDownloader({ uhrpUrl })`
   - Decrypt: `const decrypted = await wallet.decrypt({
       ciphertext: Array.from(encryptedData),
       protocolID: [2, 'agidentity-memory'],
       keyID: token.customInstructions?.keyID
     })`
   - Convert to string: `Buffer.from(decrypted.plaintext).toString('utf-8')`

4. **Build Memory objects:**
   - Return array with txid, uhrpUrl, content, tags (split tagsStr), importance, createdAt

**What to avoid:**
- Do NOT query blockchain directly (use wallet.listOutputs basket query)
- Do NOT parse PushDrop scripts manually (use PushDrop.fromScript)
- Do NOT use custom UHRP download (use storageDownloader)

Export from src/memory/index.ts.
  </action>
  <verify>
- TypeScript compiles: `npm run build`
- listMemories function exported from src/memory/index.ts
- Code inspection: Uses wallet.listOutputs({ basket: 'agent-memories' })
- Code inspection: Uses PushDrop.fromScript() to extract fields
- Code inspection: Uses storageDownloader from @bsv/sdk/storage
- Code inspection: Decrypts with protocolID [2, 'agidentity-memory']
  </verify>
  <done>
- listMemories function implemented following RESEARCH.md pattern
- Queries wallet basket (not blockchain directly)
- Extracts UHRP URLs from PushDrop token fields
- Downloads and decrypts content from UHRP
- Returns Memory[] with full content
- No TypeScript errors
  </done>
</task>

<task type="auto">
  <name>Task 2: Implement memory garbage collection with retention policies</name>
  <files>src/memory/memory-gc.ts, src/memory/index.ts</files>
  <action>
Create applyGarbageCollection function following RESEARCH.md Pattern 4:

**Signature:**
```typescript
export async function applyGarbageCollection(
  wallet: AgentWallet
): Promise<{ spent: number; kept: number }>
```

**Implementation steps (from RESEARCH.md):**
1. **Define retention policy:**
   ```typescript
   const RETENTION_POLICY = {
     high: 365 * 3,    // 3 years
     medium: 365,       // 1 year
     low: 90,           // 90 days
   };
   ```

2. **Query all memory tokens:**
   - Use wallet.listOutputs({ basket: 'agent-memories', spendable: true })

3. **Check age against policy:**
   - For each token:
     - Extract importance from PushDrop fields
     - Calculate age: `(Date.now() - token.createdAt) / (24 * 60 * 60 * 1000)` days
     - Get maxAge from RETENTION_POLICY[importance]
     - If age > maxAge: add to tokensToSpend array

4. **Spend expired tokens:**
   - If tokensToSpend.length > 0:
     - Import PushDrop for unlock script
     - Call wallet.createAction({
         description: 'Memory garbage collection',
         inputs: tokensToSpend.map(t => ({
           ...t,
           unlockingScript: new PushDrop().unlock({
             // Unlocking script to spend the token
           })
         })),
         // No outputs = tokens destroyed (spent to fees)
       })

5. **Return stats:**
   - { spent: tokensToSpend.length, kept: memories.length - tokensToSpend.length }

**What to avoid:**
- Do NOT try to delete from UHRP (provider handles expiration independently)
- Do NOT build unlock scripts manually (use PushDrop.unlock())
- Do NOT forget to check token age before spending

Export from src/memory/index.ts.
  </action>
  <verify>
- TypeScript compiles: `npm run build`
- applyGarbageCollection function exported from src/memory/index.ts
- Code inspection: RETENTION_POLICY defined with high/medium/low
- Code inspection: Checks token age against policy
- Code inspection: Uses wallet.createAction to spend expired tokens
- Code inspection: Returns statistics object
  </verify>
  <done>
- applyGarbageCollection function implemented
- Retention policy based on importance (3yr/1yr/90d)
- Spends expired tokens via wallet.createAction
- Returns spent/kept statistics
- UHRP files handled separately by provider
- No TypeScript errors
  </done>
</task>

</tasks>

<verification>
Before declaring plan complete:
- [ ] `npm run build` succeeds without errors
- [ ] listMemories function implemented with basket query
- [ ] listMemories uses PushDrop.fromScript() and storageDownloader
- [ ] applyGarbageCollection implements retention policy
- [ ] GC spends old tokens via wallet.createAction
- [ ] All imports resolve correctly
- [ ] Phase 7 complete: write, read, and lifecycle management
</verification>

<success_criteria>
- All tasks completed
- All verification checks pass
- No TypeScript errors introduced
- Agent can list/search memories from basket
- Agent can download and decrypt UHRP content
- Garbage collection enforces retention policies
- Phase 7 deliverables complete: write tool, read tool, lifecycle management
</success_criteria>

<output>
After completion, create `.planning/phases/7-memory-write-path/7-02-SUMMARY.md`:

# Phase 7 Plan 2: Memory Retrieval & Lifecycle Summary

**[Substantive one-liner - what shipped]**

## Accomplishments

- Implemented listMemories with basket query and UHRP download
- Agent can retrieve and decrypt owned memories
- Implemented garbage collection with importance-based retention
- Phase 7 complete: autonomous memory write/read/lifecycle

## Files Created/Modified

- `src/memory/memory-reader.ts` - listMemories function
- `src/memory/memory-gc.ts` - applyGarbageCollection function
- `src/memory/index.ts` - Updated exports

## Decisions Made

- Retention policy: high=3yr, medium=1yr, low=90d
- GC spends tokens (removes from basket), UHRP expiration separate
- Filter by tags/importance supported in listMemories

## Issues Encountered

[Document any issues, or "None"]

## Next Phase Readiness

**Phase 7 complete.** Agent can now:
- Write memories with PushDrop ownership proof
- List/search memories from wallet basket
- Automatically clean up old memories

**Phase 8 (Tool Registry)** can expose storeMemory and listMemories as callable tools for OpenClaw.
</output>
