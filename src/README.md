# AGIdentity Source Code Architecture

**Flat directory structure organized by domain**

---

## Folder Structure

```
src/
├── wallet/          # BRC-100 wallet, MPC wallet, PushDrop token ops
├── identity/        # Certificate authority, verifier, identity gate
├── config/          # Environment configuration
├── storage/         # Data persistence
│   ├── vault/       #   Local encrypted vault (VaultStore impl)
│   ├── uhrp/        #   UHRP blockchain storage manager
│   └── memory/      #   PushDrop memory system + MemoryManager facade
├── agent/           # Native agent loop (LLM interaction)
│   ├── tools/       #   25 declarative tools across 8 domain files
│   └── providers/   #   LLM providers (Anthropic, Ollama)
├── gateway/         # AGIdentity gateway (orchestrates everything)
├── messaging/       # MessageBox client, conversation manager, gated handler
├── encryption/      # Per-interaction encryption helpers
├── integrations/    # External service connectors
│   ├── shad/        #   Semantic memory (Shad encrypted vault)
│   ├── x402/        #   Authenticated payments (x402 protocol)
│   ├── overlay/     #   BSV overlay network lookup
│   ├── gepa/        #   Prompt optimization (GEPA)
│   └── team/        #   Team vault with certificate-based access
├── server/          # BRC-103/104 authenticated HTTP API
├── client/          # Authenticated HTTP client SDK
├── cli/             # Employee-side CLI (chat REPL)
├── types/           # Shared type definitions (BRC100Wallet, VaultStore, etc.)
├── audit/           # Anchor chain, signed audit trail, workspace integrity
│
├── __tests__/       # Test files
├── index.ts         # Public API exports
└── start.ts         # Gateway startup script
```

---

## Key Concepts

### Agent Tools (What the AI Can Call)

Defined in `agent/tools/` as declarative `ToolDescriptor` objects:

```typescript
interface ToolDescriptor {
  definition: AgentToolDefinition;  // name, description, input_schema
  execute: (params, ctx) => Promise<ToolResult>;
  requiresWallet: boolean;          // controls parallel vs sequential execution
}
```

8 domain files: `identity.ts`, `wallet-ops.ts`, `transactions.ts`, `tokens.ts`, `messaging.ts`, `memory.ts`, `services.ts`, `audit.ts`

**Everything else is infrastructure that tools call into.**

### Execution Model

- Read-only tools (`requiresWallet: false`) execute in **parallel** via `Promise.all`
- Wallet tools (`requiresWallet: true`) execute **sequentially** to respect the MPC signing lock
- Results are re-ordered to match the original `tool_use_id` order for the Anthropic API

### VaultStore Interface

Unified storage interface implemented by three backends:

| Implementation | Backend |
|---------------|---------|
| `LocalEncryptedVault` | Local filesystem with AES encryption |
| `ShadVaultAdapter` | Shad semantic document store |
| `TeamVaultAdapter` | Team vault with certificate-based access |

### MemoryManager

Unified facade for the PushDrop memory system:

- `store()` — Write memory to blockchain via PushDrop tokens
- `recall()` — Read memories with optional semantic search (via Shad)
- `gc()` — Garbage collect expired memories

---

## Quick Reference

| Directory | Purpose |
|-----------|---------|
| `wallet/` | MPC wallet, key derivation, PushDrop ops |
| `identity/` | Certificate authority, verification, identity gate |
| `config/` | Environment config loading |
| `storage/vault/` | Local encrypted vault |
| `storage/uhrp/` | UHRP blockchain storage |
| `storage/memory/` | PushDrop memory + MemoryManager |
| `agent/` | Agent loop, tool registry, prompt builder |
| `agent/tools/` | 25 declarative agent tools |
| `agent/providers/` | LLM providers (Anthropic, Ollama) |
| `gateway/` | Main gateway orchestration |
| `messaging/` | MessageBox P2P messaging |
| `encryption/` | Per-interaction encryption |
| `integrations/shad/` | Semantic memory (Shad) |
| `integrations/x402/` | Authenticated payments |
| `integrations/overlay/` | BSV overlay lookup |
| `integrations/gepa/` | Prompt optimization |
| `integrations/team/` | Team vault + secure team vault |
| `server/` | BRC-103/104 authenticated HTTP API |
| `client/` | HTTP client SDK |
| `cli/` | Employee chat CLI |
| `types/` | Shared type definitions |
| `audit/` | Anchor chain, audit trail, workspace integrity |
