# AGIdentity Architecture: What's What

## 🎯 The Confusion

```
Current src/ mixes:
- OpenClaw tools (AI callable)
- Infrastructure (background systems)
- Helper code (internal utilities)
- External integrations (services)
- Storage backends (implementations)
```

---

## 📊 Visual Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  USER                                                       │
│  (MessageBox P2P or CLI)                                    │
└──────────────────┬──────────────────────────────────────────┘
                   │
            [Encrypted Message]
                   │
┌──────────────────▼──────────────────────────────────────────┐
│  INFRASTRUCTURE LAYER (src/gateway/, src/messaging/)        │
│  ═══════════════════════════════════════════════════════    │
│                                                              │
│  src/gateway/ - AGIdentity Gateway                          │
│  ├─ Receives messages (src/messaging/)                      │
│  ├─ Verifies identity (src/identity/)                       │
│  ├─ Decrypts (src/encryption/)                              │
│  └─ Routes to OpenClaw (src/openclaw/)                      │
│                                                              │
│  src/messaging/ - MessageBox Gateway                        │
│  └─ P2P encrypted messaging infrastructure                  │
│                                                              │
│  src/identity/ - Identity Gate                              │
│  └─ Certificate verification (WHO sent this?)               │
│                                                              │
│  src/wallet/ - MPC Wallet                                   │
│  └─ 2-of-3 threshold signatures (agent's identity)          │
│                                                              │
└──────────────────┬──────────────────────────────────────────┘
                   │
            Routes to OpenClaw
                   │
┌──────────────────▼──────────────────────────────────────────┐
│  OPENCLAW AI LAYER                                          │
│  ═══════════════════════════════════════════════════════    │
│                                                              │
│  OpenClaw AI (Claude Opus 4.6)                              │
│  Thinks and decides what to do                              │
│                                                              │
│  Has access to TOOLS: ←─────────────────────────┐           │
│                                                  │           │
└──────────────────┬───────────────────────────────┼───────────┘
                   │                               │
         Calls tools when needed                   │
                   │                               │
┌──────────────────▼───────────────────────────────┼───────────┐
│  TOOLS LAYER (src/tools/) ←─────────────────────┘           │
│  ═══════════════════════════════════════════════════════    │
│                                                              │
│  These ARE OpenClaw tools (AI calls them):                  │
│                                                              │
│  📞 agid_identity          → Get my public key              │
│  📞 agid_sign              → Sign a message                 │
│  📞 agid_encrypt           → Encrypt data                   │
│  📞 agid_decrypt           → Decrypt data                   │
│  📞 agid_balance           → Check wallet                   │
│  📞 agid_create_memory     → Store onchain                  │
│  📞 agid_search_memory     → Search memories                │
│                                                              │
│  Tools USE infrastructure:                                  │
│  └──> src/wallet/ (for signing)                             │
│  └──> src/vault/ (for storage)                              │
│  └──> src/memory/ (for search)                              │
│                                                              │
└──────────────────┬──────────────────────────────────────────┘
                   │
         Tools use backends
                   │
┌──────────────────▼──────────────────────────────────────────┐
│  STORAGE BACKENDS (src/vault/, src/uhrp/, src/memory/)      │
│  ═══════════════════════════════════════════════════════    │
│                                                              │
│  src/vault/ - Vault Interface + LocalEncryptedVault         │
│  └─ Fast local file storage (Obsidian integration)          │
│                                                              │
│  src/uhrp/ - UHRP Storage Manager                           │
│  └─ Blockchain-backed storage (slow, verifiable)            │
│                                                              │
│  src/memory/ - Memory System                                │
│  └─ Memory server (search, retrieve, garbage collection)    │
│                                                              │
│  Relationship:                                               │
│  VaultInterface → LocalEncryptedVault (fast)                │
│               → EncryptedShadVault uses UHRP (slow)         │
│                                                              │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│  EXTERNAL INTEGRATIONS (src/shad/, src/openclaw/)            │
│  ═══════════════════════════════════════════════════════    │
│                                                              │
│  src/shad/ - Shad Integration                               │
│  └─ Python AI research daemon (external process)            │
│                                                              │
│  src/openclaw/ - OpenClaw Client                            │
│  └─ Connect to OpenClaw gateway (external service)          │
│                                                              │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│  SHARED UTILITIES (src/encryption/, src/config/, src/types/) │
│  ═══════════════════════════════════════════════════════    │
│                                                              │
│  Used by everything:                                         │
│  - src/encryption/ - Crypto helpers                          │
│  - src/config/ - Config loading                              │
│  - src/types/ - Type definitions                             │
│  - src/audit/ - Logging                                      │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

## 📋 Folder Purpose Summary

| Folder | Type | Purpose | Is Tool? |
|--------|------|---------|----------|
| `tools/` | Tools | AI-callable functions | ✅ YES |
| `gateway/` | Infrastructure | Message routing/verification | ❌ NO |
| `messaging/` | Infrastructure | MessageBox P2P transport | ❌ NO |
| `wallet/` | Infrastructure | MPC wallet (identity) | ❌ NO |
| `identity/` | Infrastructure | Certificate verification | ❌ NO |
| `server/` | Infrastructure | HTTP API server | ❌ NO |
| `vault/` | Storage Backend | Local file storage | ❌ NO (but tools use it) |
| `uhrp/` | Storage Backend | Blockchain storage | ❌ NO (but tools use it) |
| `memory/` | Storage Backend | Memory system | ❌ NO (but exposes tools) |
| `openclaw/` | Integration | OpenClaw client | ❌ NO |
| `shad/` | Integration | Shad AI service | ❌ NO |
| `encryption/` | Helpers | Crypto utilities | ❌ NO |
| `config/` | Helpers | Config loading | ❌ NO |
| `types/` | Helpers | TypeScript types | ❌ NO |
| `cli/` | Interface | Command-line tool | ❌ NO |
| `client/` | Interface | SDK library | ❌ NO |
| `service/` | Factory | Service composer | ❌ NO |

**Only 1 folder out of 22 is actual OpenClaw tools!**

---

## 🎯 Clearer Structure Proposal

### Reorganize into layers:

```
src/
├── 01-core/                 # Core infrastructure (wallet, identity, config)
│   ├── wallet/              # MPC wallet
│   ├── identity/            # Verification
│   └── config/              # Configuration
│
├── 02-storage/              # Storage implementations
│   ├── vault-interface.ts   # Abstract interface
│   ├── local-vault/         # Local file storage
│   ├── uhrp-storage/        # Blockchain storage
│   └── memory/              # Memory system
│
├── 03-gateway/              # AGIdentity Gateway (the main system)
│   ├── gateway.ts           # Main gateway
│   ├── messaging/           # MessageBox integration
│   ├── auth/                # Authentication
│   └── encryption/          # Crypto helpers
│
├── 04-integrations/         # External services
│   ├── openclaw/            # OpenClaw client
│   ├── shad/                # Shad AI
│   └── team/                # Team features
│
├── 05-interfaces/           # How external code uses AGIdentity
│   ├── http-server/         # REST API
│   ├── cli/                 # Command-line
│   └── client-sdk/          # Library for other apps
│
├── 06-tools/                # OpenClaw AI Tools (what AI calls)
│   ├── wallet-tools.ts      # THESE are tools!
│   ├── memory-tools.ts      # THESE are tools!
│   └── identity-tools.ts    # THESE are tools!
│
└── shared/                  # Shared utilities
    ├── types/
    ├── audit/
    └── payment/
```

**Benefit:** Numbers show dependency order, clear layering

---

## 💡 Key Insights

### 1. Only ONE folder is actual tools

Out of 22 folders in src/, only `src/tools/` contains OpenClaw tools.

Everything else is:
- Infrastructure (runs in background)
- Storage (data persistence)
- Integrations (external services)
- Interfaces (how to access AGIdentity)
- Helpers (shared utilities)

### 2. Vault ≠ UHRP

**Vault** = Storage abstraction
```typescript
interface VaultInterface {
  read(path): Promise<string>
  write(path, content): Promise<void>
  search(query): Promise<results>
}
```

**Implementations:**
- `src/vault/local-encrypted-vault.ts` - Local files (fast)
- `src/shad/encrypted-vault.ts` - UHRP blockchain (slow, verifiable)

**UHRP** = Blockchain storage protocol
- `src/uhrp/storage-manager.ts` - Manages UHRP uploads
- Used BY EncryptedShadVault
- Not a vault itself - it's a storage backend

### 3. Shad is external

**Shad** = Separate Python AI daemon
- Lives outside AGIdentity
- AGIdentity integrates with it
- `src/shad/` = Integration code, not Shad itself

---

## 🎯 Recommended Action

**Before pushing, let's reorganize for clarity:**

**Option 1:** Full reorganization (Option A) - Clean but time-consuming

**Option 2:** Add README.md to each folder - Quick, adds clarity

**Option 3:** Just update main README.md with architecture diagram - Fastest

**Which do you prefer?**
