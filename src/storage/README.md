# 02-storage: Storage Backends

**Purpose:** Data persistence implementations (encrypted storage)

## Folders

### `vault/`
**What:** Vault interface + LocalEncryptedVault implementation
**Storage Type:** Local files (fast, Obsidian integration)
**Is Tool:** ❌ NO - But tools USE it for storage
**Encryption:** Per-interaction encryption with wallet-derived keys

### `uhrp/`
**What:** UHRP (Universal Hash Resolution Protocol) storage manager
**Storage Type:** Blockchain-backed distributed storage
**Is Tool:** ❌ NO - Backend for EncryptedShadVault
**Provides:** Verifiable proof, blockchain timestamps

### `memory/`
**What:** Agent memory system (long-term context)
**Is Tool:** ⚠️ SORT OF - Exposes memory_search, memory_get as MCP tools
**Provides:** Semantic search, memory management, garbage collection
**Used By:** OpenClaw (via MCP), Shad integration

---

## Relationship

```
VaultInterface (abstract)
  ├── LocalEncryptedVault (vault/) - Fast local files
  └── EncryptedShadVault (shad/) - Uses UHRP for blockchain storage
```

**vault/ ≠ uhrp/**
- Vault is LOCAL storage (fast)
- UHRP is BLOCKCHAIN storage (slow, verifiable)
- Both implement storage, different backends

---

**Key Point:** Storage backends are infrastructure, but memory/ also exposes tools for AI to search/retrieve memories.
