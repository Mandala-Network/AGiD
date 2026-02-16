# src/ Folder Confusion Analysis

## 🎯 The Core Question

**What is an OpenClaw tool?**
- A tool = Function the AI agent can CALL during a conversation
- Example: AI decides "I need to sign this" → calls `agid_sign` tool

**What is NOT a tool?**
- Infrastructure that runs in the background
- Services the AI doesn't directly call
- Helper code used by infrastructure

---

## 📊 Current src/ Categorization

### 1️⃣ OPENCLAW TOOLS (What AI Can Call)

**`src/tools/`** ✅ These ARE tools
- `wallet-tools.ts` - Tools exposed to OpenClaw
- `identity-tools.ts` - Self-awareness tools
- **Purpose:** Functions AI agent calls during conversations
- **Used by:** OpenClaw AI
- **Examples:** agid_sign, agid_encrypt, agid_balance

**Should also be tools but aren't clearly marked:**
- `src/memory/` - Could expose memory_search, memory_get as tools
- Parts of `src/vault/` - vault_store, vault_read could be tools

---

### 2️⃣ INFRASTRUCTURE (Always Running, Not Tools)

**`src/gateway/`** - AGIdentity Gateway wrapper
- **What it is:** Wraps OpenClaw with identity verification
- **NOT a tool:** It's the container everything runs in
- **Purpose:** MessageBox → Verify → OpenClaw → Sign → Response

**`src/messaging/`** - MessageBox P2P
- **What it is:** Encrypted P2P message transport
- **NOT a tool:** Infrastructure for receiving/sending messages
- **Purpose:** Gateway component for P2P communication

**`src/wallet/`** - MPC Wallet
- **What it is:** Agent's cryptographic identity and signing capability
- **NOT a tool:** Core infrastructure (but tools USE it)
- **Purpose:** Provides identity, signing, encryption primitives

**`src/identity/`** - Identity verification
- **What it is:** Certificate verification system
- **NOT a tool:** Security infrastructure
- **Purpose:** Verify sender certificates before processing

**`src/server/`** - HTTP API server
- **What it is:** REST API for external access
- **NOT a tool:** Infrastructure (but tools call it)
- **Purpose:** HTTP interface to wallet operations

**`src/auth/`** - Session management
- **What it is:** BRC-103/104 authentication
- **NOT a tool:** Infrastructure
- **Purpose:** Session tracking for HTTP server

---

### 3️⃣ STORAGE BACKENDS (Infrastructure)

**`src/vault/`** - Local encrypted vault
- **What it is:** Interface + LocalEncryptedVault implementation
- **Storage type:** Local files (fast, Obsidian integration)
- **NOT the same as UHRP**

**`src/uhrp/`** - UHRP blockchain storage
- **What it is:** Distributed storage with blockchain proof
- **Storage type:** Blockchain-backed (slow, verifiable)
- **NOT the same as vault**

**Relationship:**
```
VaultInterface (abstract)
  ├── LocalEncryptedVault (src/vault/) - Fast local storage
  └── EncryptedShadVault (src/shad/) - UHRP blockchain storage
```

**Confusion:**
- "Vault" is the interface
- "UHRP" is one implementation
- They're related but different things

---

### 4️⃣ EXTERNAL SERVICE INTEGRATIONS (Not Tools)

**`src/openclaw/`** - OpenClaw client
- **What it is:** WebSocket client to connect to OpenClaw gateway
- **NOT a tool:** The AI runs IN OpenClaw, this connects TO it
- **Purpose:** Gateway → OpenClaw communication

**`src/shad/`** - Shad AI research daemon
- **What it is:** Python subprocess for complex AI research
- **NOT a tool (directly):** External service AGIdentity integrates with
- **Purpose:** Complex analysis tasks beyond OpenClaw capabilities

**`src/memory/`** - Memory MCP server
- **What it is:** MCP server exposing memory search/retrieval
- **Sort of tools:** Exposes memory_search, memory_get
- **Purpose:** Long-term memory for AI agents

---

### 5️⃣ HELPER CODE (Internal Utilities)

**`src/encryption/`** - Encryption helpers
- **What it is:** PerInteractionEncryption, SessionEncryption
- **NOT tools:** Internal crypto helpers
- **Used by:** Messaging, vault, gateway

**`src/config/`** - Configuration loading
- **What it is:** Environment variable parsing
- **NOT tools:** Startup configuration
- **Used by:** Everything

**`src/types/`** - TypeScript types
- **What it is:** Type definitions
- **NOT tools:** Type system
- **Used by:** Everything

**`src/audit/`** - Audit trail
- **What it is:** Signed audit logging
- **NOT tools:** Background logging
- **Purpose:** Compliance and debugging

**`src/payment/`** - Payment handling
- **What it is:** Payment processing (placeholder?)
- **Status:** Unclear if implemented

**`src/team/`** - Team vault
- **What it is:** Shared vault for multiple agents
- **NOT tools:** Infrastructure for multi-agent teams

---

### 6️⃣ INTERFACES (Not Implementation)

**`src/client/`** - AGIdentity client SDK
- **What it is:** HTTP client for external apps to use AGIdentity
- **NOT tools:** Client library
- **Purpose:** SDK for other apps to call AGIdentity

**`src/service/`** - Service composition
- **What it is:** AGIdentityService facade
- **NOT tools:** Factory/composer
- **Purpose:** Creates complete AGIdentity instance

**`src/cli/`** - Command-line interface
- **What it is:** CLI commands (agid info, agid chat)
- **NOT tools:** User-facing CLI
- **Purpose:** Human → Agent interaction

---

## 🎯 The Confusion Explained

### Your Questions:

**Q: "Are all src files tools for OpenClaw?"**
**A:** NO! Only `src/tools/` are actual tools. Everything else is infrastructure.

**Q: "Utilities could be helper code for the agent?"**
**A:** `utilities/` (root) are scripts YOU run. `src/` helper code is used BY the agent internally.

**Q: "Shad is a service?"**
**A:** Yes! Shad is an external Python AI service. NOT a tool (though agent could call it via integration).

**Q: "Vault and UHRP are the same thing?"**
**A:** NO! Vault = interface/abstraction. UHRP = one storage backend. LocalVault = another backend.
```
Vault Interface
  ├── LocalEncryptedVault (fast, local files)
  └── EncryptedShadVault (slow, blockchain UHRP)
```

---

## 🔧 Proposed Clearer Structure

### Option A: Reorganize by Purpose

```
src/
├── core/                    # Core infrastructure
│   ├── wallet/              # MPC wallet
│   ├── identity/            # Identity verification
│   └── config/              # Configuration
│
├── gateway/                 # AGIdentity Gateway
│   ├── main.ts              # Gateway implementation
│   ├── messaging/           # MessageBox integration
│   └── auth/                # Authentication
│
├── storage/                 # Storage backends
│   ├── vault/               # Vault interface
│   ├── local-vault.ts       # Local implementation
│   └── uhrp-vault.ts        # UHRP implementation
│
├── integrations/            # External services
│   ├── openclaw/            # OpenClaw client
│   ├── shad/                # Shad AI daemon
│   └── messagebox/          # MessageBox (move from messaging)
│
├── tools/                   # OpenClaw tools (AI callable)
│   ├── wallet-tools.ts      # Sign, encrypt, balance
│   ├── memory-tools.ts      # Search, store, recall
│   └── identity-tools.ts    # Self-awareness
│
├── interfaces/              # External interfaces
│   ├── http-server/         # HTTP API (move from server/)
│   ├── cli/                 # CLI tool
│   └── client-sdk/          # Client library (move from client/)
│
└── shared/                  # Shared code
    ├── types/               # TypeScript types
    ├── encryption/          # Crypto helpers
    └── audit/               # Audit logging
```

**Benefit:** Clear separation of concerns

---

### Option B: Keep Current, Add README per folder

```
src/
├── gateway/
│   └── README.md → "This wraps OpenClaw with identity. NOT a tool."
├── tools/
│   └── README.md → "These ARE OpenClaw tools. AI calls these."
├── wallet/
│   └── README.md → "MPC wallet infrastructure. NOT a tool (but tools use it)."
└── ... (etc)
```

**Benefit:** Less disruptive, just add clarity

---

### Option C: Separate tools/ from infrastructure/

```
src/
├── infrastructure/          # Everything that runs in background
│   ├── gateway/
│   ├── wallet/
│   ├── messaging/
│   ├── identity/
│   └── ...
│
└── tools/                   # Only OpenClaw-callable tools
    ├── wallet-tools.ts
    ├── memory-tools.ts
    └── identity-tools.ts
```

**Benefit:** Very clear what's a tool vs infrastructure

---

## 🎓 Clear Definitions

### OpenClaw Tool
```typescript
// AI can call this during conversation
export const agid_sign = {
  name: 'agid_sign',
  description: 'Sign a message',
  execute: async (params) => {
    // Uses wallet infrastructure
    const sig = await wallet.createSignature(...)
    return sig
  }
}
```

### Infrastructure
```typescript
// Runs in background, AI doesn't call it
class MPCWallet {
  // Used BY tools, not called BY AI
  async createSignature(...) { }
}
```

### Helper Code
```typescript
// Used internally
function encryptData(data) {
  // Internal utility
}
```

---

## 📋 Specific Answers to Your Questions

**"Utilities could be helper code?"**
- `utilities/` (root) = Scripts YOU run manually
- Helper code = `src/encryption/`, `src/config/` used internally
- Different things!

**"Shad is a service?"**
- YES! External Python AI service
- AGIdentity integrates with it
- Not an OpenClaw tool (though could expose one)

**"Vault and UHRP same thing?"**
- NO!
- Vault = Storage interface (abstract concept)
- LocalEncryptedVault = Local file implementation
- EncryptedShadVault = UHRP blockchain implementation
- UHRP = One of several vault backends

---

## 🎯 Recommendation

**Before we push, should we:**

**A.** Reorganize src/ for clarity (Option A above) - 1-2 hours
**B.** Add README.md to each src/ folder explaining purpose - 30 min
**C.** Leave as-is, just document in main README - 10 min

**Which would you prefer?**

I can also create a visual diagram showing what connects to what if that would help clarify!