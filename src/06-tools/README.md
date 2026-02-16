# 06-tools: OpenClaw AI Tools

**Purpose:** ⭐ THESE ARE THE ACTUAL OPENCLAW TOOLS ⭐

## What is a Tool?

**A tool = Function the AI agent can CALL during a conversation**

```
User: "Sign this contract"
    ↓
OpenClaw AI thinks: "I need to use my signing tool"
    ↓
AI calls: agid_sign({ message: "contract text" })
    ↓
Tool executes: Uses MPC wallet to create signature
    ↓
AI responds: "Contract signed! Signature: 3044..."
```

---

## Folders

### `tools/`

**Files:**
- `wallet-tools.ts` - Wallet operation tools
- `identity-tools.ts` - Self-awareness tools
- `agid-mcp-server.ts` - MCP server exposing tools

**Tools Provided:**

#### Wallet Tools (AI can use wallet)
- `agid_identity` - Get my BSV public key
- `agid_sign` - Sign a message (MPC threshold signature)
- `agid_encrypt` - Encrypt data
- `agid_decrypt` - Decrypt data
- `agid_balance` - Check wallet balance
- `agid_create_transaction` - Build BSV transaction
- `agid_create_memory` - Store onchain memory token

#### Memory Tools (AI can use memory)
- `agid_store_memory` - Store in long-term memory
- `agid_recall_memory` - Search memories

#### Identity Tools (AI self-awareness)
- Tools for agent to query its own identity

---

## How Tools Work

```
OpenClaw AI Agent
    ↓
Decides to use tool
    ↓
Calls: agid_sign({ message: "test" })
    ↓
Tool Implementation:
  1. Receives parameters from AI
  2. Calls HTTP API: POST /api/sign
  3. Server uses MPC wallet to sign
  4. Returns signature to AI
    ↓
AI gets result and responds to user
```

**Tools are the BRIDGE between AI and wallet/storage!**

---

## Relationship to Infrastructure

```
Tools (this folder)
  ↓ USE (via HTTP or direct)
Infrastructure
  ├─ 01-core/wallet (for signing)
  ├─ 02-storage/memory (for memories)
  └─ 02-storage/vault (for storage)
```

**Tools are thin wrappers** that expose infrastructure to AI in a callable format.

---

## OpenClaw Plugin

**Location:** `~/.openclaw/extensions/agidentity-tools/`

**Loads these tools** from this folder and registers them with OpenClaw.

**Status:** ✅ Working - 4 tools loaded successfully

---

**Key Point:** If it's in this folder, the AI can call it. If it's NOT in this folder, it's infrastructure/helpers, not a tool.
