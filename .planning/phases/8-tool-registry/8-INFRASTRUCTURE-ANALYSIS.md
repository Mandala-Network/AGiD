# Phase 8: Infrastructure Analysis
## Leveraging Existing AGIdentity Components

**Date:** 2026-02-15

## Existing Infrastructure Inventory

### 1. HTTP Server (`src/server/auth-server.ts`)
**Status:** ✅ Production-ready, fully implemented

**Features:**
- Express HTTP server with BRC-103/104 mutual authentication
- `@bsv/auth-express-middleware` for cryptographic auth
- Session tracking via `activeSessions` Map
- Existing endpoints:
  - `/identity` - Identity info
  - `/identity/register` - Session registration
  - `/vault/*` - Vault operations (init, store, read, search, proof)
  - `/team/*` - Team collaboration
  - `/sign` - Message signing
  - `/verify` - Signature verification
  - `/health`, `/status` - Health checks
- Port configuration: `config.serverPort` or `AGID_SERVER_PORT`
- Error handling, logging, structured responses

**Key Pattern:**
```typescript
const authMiddleware = createAuthMiddleware({
  wallet: underlyingWallet,
  allowUnauthenticated: false,
  certificatesToRequest: { certifiers: [...], types: {...} },
  onCertificatesReceived: async (senderKey, certs, req, res, next) => {
    // Verify with IdentityGate
  }
});

app.use(express.json());
app.use(authMiddleware);

// Endpoints automatically authenticated
app.get('/vault/list', (req: AuthRequest, res: Response) => {
  const clientKey = getClientKey(req); // From auth middleware
  // ... validate session, execute, respond
});
```

### 2. HTTP Client (`src/client/agidentity-client.ts`)
**Status:** ✅ Production-ready, client SDK for auth-server

**Features:**
- Authenticated fetch using BRC-103 signatures
- Retry logic with exponential backoff
- Timeout handling
- Wrapper methods for all server endpoints
- Type-safe response handling

**Key Pattern:**
```typescript
const client = new AGIDClient({
  wallet,
  serverUrl: 'http://localhost:3000',
  timeout: 30000,
  retries: 3
});

await client.initialize();
await client.registerSession();
const result = await client.storeDocument('path', 'content');
```

### 3. Memory Server (`src/memory/agidentity-memory-server.ts`)
**Status:** ✅ MCP-compatible, ready for tool exposure

**Features:**
- MCP-compatible tool interface
- Methods: `memory_search`, `memory_get`, `verify_document`
- Returns `MCPToolResponse` format
- Works with both `LocalEncryptedVault` and `EncryptedShadVault`

**Key Pattern:**
```typescript
const memoryServer = createAGIdentityMemoryServer({ vault });

const response = await memoryServer.memory_search(query, limit);
// Returns: { content: [{ type: 'text', text: JSON.stringify({results, count, query}) }] }
```

### 4. Identity Tools (`src/tools/identity-tools.ts`)
**Status:** ✅ Implemented, simple function interface

**Features:**
- `getIdentity(wallet)` - Get agent's public key and capabilities
- `proveIdentity(wallet, data)` - Create cryptographic identity proof

**Key Pattern:**
```typescript
const identity = await getIdentity(wallet);
// Returns: { publicKey, capabilities: ['sign', 'encrypt', 'transact'], network }

const proof = await proveIdentity(wallet, message);
// Returns: { signature, publicKey, data, timestamp }
```

### 5. Wallet Interface (`src/wallet/agent-wallet.ts`)
**Status:** ✅ Fully implemented with MPC support

**Features:**
- `getBalance()` - Get satoshi balance and UTXOs
- `createTransaction(...)` - Create unsigned transaction
- `createSignature(...)` - Sign with protocol ID
- `getPublicKey(...)` - Get identity or payment keys
- `getNetwork()` - mainnet/testnet
- MPC wallet support via dependency injection

### 6. OpenClaw Gateway (`src/gateway/agidentity-openclaw-gateway.ts`)
**Status:** ✅ WebSocket client, no HTTP server

**Features:**
- Connects to OpenClaw via WebSocket
- Identity context injection into chat messages
- Memory auto-retrieval before sending to OpenClaw
- Response signing with MPC wallet
- Integrates: MessageBox → IdentityGate → OpenClaw → MPC Sign

**Gap:** No HTTP server to expose wallet/memory operations to plugins

---

## Open Question Resolutions

### Question 1: HTTP API Design
**Should we add HTTP server to existing gateway or run separately?**

**Answer:** ✅ **Extend the existing `auth-server.ts`**

**Rationale:**
1. **Reuse BRC-103/104 auth** - Already implemented and tested
2. **Reuse session management** - `activeSessions` tracking works perfectly
3. **Single server architecture** - One port, one process, unified config
4. **Consistent API patterns** - Vault/team endpoints already follow conventions
5. **Avoid port conflicts** - No need for multiple servers

**Implementation:**
- Add wallet endpoints to `auth-server.ts`:
  - `GET /wallet/balance`
  - `POST /wallet/create-transaction`
  - `POST /wallet/sign-message`
  - `GET /wallet/network`
- Add memory endpoints to `auth-server.ts`:
  - `POST /memory/search`
  - `GET /memory/get/:path`
- Integrate with existing `AGIdentityMemoryServer` instance
- Use existing wallet from server config

**Code Structure:**
```typescript
// src/server/auth-server.ts

// Add to createAGIDServer() after existing endpoints:

// =========================================================================
// Wallet Endpoints (for OpenClaw plugin)
// =========================================================================

app.get('/wallet/balance', async (req: AuthRequest, res: Response) => {
  const clientKey = getClientKey(req);
  if (!clientKey) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  try {
    const balance = await config.wallet.getBalance();
    updateSession(clientKey);
    res.json({ success: true, ...balance });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.post('/wallet/create-transaction', async (req: AuthRequest, res: Response) => {
  const clientKey = getClientKey(req);
  if (!clientKey) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const { recipient, satoshis, data } = req.body;
  if (!recipient || !satoshis) {
    res.status(400).json({ error: 'Missing recipient or satoshis' });
    return;
  }

  try {
    const tx = await config.wallet.createTransaction({
      outputs: [{ to: recipient, satoshis, data: data ? Buffer.from(data, 'hex') : undefined }]
    });
    updateSession(clientKey);
    res.json({ success: true, txHex: tx.tx, txid: tx.txid });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// =========================================================================
// Memory Endpoints (for OpenClaw plugin)
// =========================================================================

app.post('/memory/search', async (req: AuthRequest, res: Response) => {
  const clientKey = getClientKey(req);
  if (!clientKey) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  if (!config.memoryServer) {
    res.status(503).json({ error: 'Memory server not configured' });
    return;
  }

  const { query, limit } = req.body;
  if (!query) {
    res.status(400).json({ error: 'Missing query' });
    return;
  }

  try {
    const response = await config.memoryServer.memory_search(query, limit ?? 10);
    updateSession(clientKey);
    res.json({ success: true, ...JSON.parse(response.content[0].text) });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.get('/memory/get/:path(*)', async (req: AuthRequest, res: Response) => {
  const clientKey = getClientKey(req);
  if (!clientKey) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  if (!config.memoryServer) {
    res.status(503).json({ error: 'Memory server not configured' });
    return;
  }

  try {
    const response = await config.memoryServer.memory_get(getParam(req.params.path));
    updateSession(clientKey);
    const data = JSON.parse(response.content[0].text);
    if (data.error) {
      res.status(404).json(data);
      return;
    }
    res.json({ success: true, ...data });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});
```

**Server Config Update:**
```typescript
export interface AGIDServerConfig {
  wallet: AgentWallet;
  identityGate: IdentityGate;
  vault: EncryptedShadVault;
  teamVault: TeamVault;
  memoryServer?: AGIdentityMemoryServer;  // Add optional memory server
  port?: number;
  trustedCertifiers: string[];
  allowUnauthenticated?: boolean;
  enableLogging?: boolean;
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
}
```

---

### Question 2: Authentication Between Plugin and Gateway
**What auth mechanism (JWT, API key, mTLS)?**

**Answer:** ✅ **BRC-103/104 mutual authentication** (already implemented)

**Rationale:**
1. **Already implemented** - No new code needed
2. **Cryptographically secure** - Uses wallet signatures, no shared secrets
3. **Certificate-based trust** - Supports identity verification via certificates
4. **Consistent with ecosystem** - Same auth as vault, team endpoints
5. **Revocation support** - Certificates can be revoked on-chain
6. **No token management** - No JWT expiry, refresh tokens, or key rotation

**How it works:**
1. OpenClaw plugin creates `AGIDClient` with wallet
2. Client signs requests with BRC-103 protocol
3. Server validates signature using `auth-express-middleware`
4. Optional: Verify plugin has valid certificate from trusted certifier
5. Session tracked in `activeSessions` Map

**Plugin Implementation:**
```typescript
// extensions/agidentity-tools/src/api-client.ts
import { createAGIDClient } from 'agidentity';

export function createPluginClient(config: {
  wallet: AgentWallet;
  gatewayUrl: string;
}) {
  const client = createAGIDClient({
    wallet: config.wallet,
    serverUrl: config.gatewayUrl,
    timeout: 30000,
    retries: 3,
    debug: false
  });

  return client;
}
```

**OpenClaw Plugin Tool:**
```typescript
// extensions/agidentity-tools/src/wallet-tools.ts
async execute(toolCallId, params, signal) {
  // AGIDClient handles BRC-103 auth automatically
  const response = await client.request('GET', '/wallet/balance');

  return {
    content: [{ type: 'text', text: JSON.stringify(response.data) }],
    details: response.data
  };
}
```

**Alternative (if BRC-103 causes issues):**
Use simple Bearer token as fallback:
```typescript
// In plugin config (config.json5)
{
  "plugins": {
    "agidentity-tools": {
      "gatewayUrl": "http://localhost:3000",
      "authToken": "secure-random-token-here"  // Shared secret
    }
  }
}

// In server config
{
  "allowUnauthenticated": true,  // Skip BRC-103 verification
  "bearerTokens": ["secure-random-token-here"]  // Validate against this list
}
```

**Recommendation:** Start with BRC-103, fallback to Bearer token only if needed

---

### Question 3: Tool Approval Workflow
**Should approval happen in plugin or in gateway?**

**Answer:** ✅ **Implement approval in gateway** (defer to Phase 9)

**Rationale:**
1. **Security** - Approval logic should live in trusted gateway, not plugin
2. **Separation of concerns** - Plugin is thin adapter, gateway enforces policy
3. **Centralized enforcement** - All wallet operations go through gateway approval
4. **Auditable** - Approval decisions logged in gateway, not scattered across plugins
5. **Flexible** - Can change approval policy without updating plugins

**Phase 8 Implementation:**
- Plugin calls `/wallet/create-transaction` directly
- Server executes immediately (no approval yet)
- Returns transaction hex to plugin
- Plugin returns result to OpenClaw

**Phase 9 Enhancement:**
- Add approval queue to gateway
- `/wallet/create-transaction` creates pending approval
- Returns `{ status: 'pending', approvalId: '...' }`
- Plugin waits or polls for approval
- User approves via MessageBox
- Transaction executed after approval
- Plugin gets final result

**Phase 8 Plugin (No Approval):**
```typescript
async execute(toolCallId, params) {
  const response = await client.request('POST', '/wallet/create-transaction', params);

  if (!response.success) {
    throw new Error(response.error);
  }

  return {
    content: [{ type: 'text', text: `Transaction created: ${response.data.txid}` }],
    details: response.data
  };
}
```

**Phase 9 Plugin (With Approval):**
```typescript
async execute(toolCallId, params, signal) {
  const response = await client.request('POST', '/wallet/create-transaction', params);

  if (!response.success) {
    throw new Error(response.error);
  }

  // Check if approval required
  if (response.data.status === 'pending') {
    // Wait for approval (with polling or webhook)
    const approved = await waitForApproval(response.data.approvalId, signal);
    if (!approved) {
      throw new Error('Transaction approval denied');
    }
  }

  return {
    content: [{ type: 'text', text: `Transaction created: ${response.data.txid}` }],
    details: response.data
  };
}
```

---

## Recommended Architecture

### Updated Architecture Diagram
```
┌───────────────────────────────────────────────────────────────┐
│ OpenClaw Server                                                │
│                                                                │
│  extensions/agidentity-tools/                                  │
│  ├── index.ts (register tools)                                │
│  ├── src/wallet-tools.ts                                      │
│  ├── src/memory-tools.ts                                      │
│  └── src/api-client.ts (AGIDClient instance)                  │
│          │                                                     │
│          │ BRC-103 authenticated HTTP                          │
│          ▼                                                     │
└──────────┼─────────────────────────────────────────────────────┘
           │
           │ POST /wallet/balance
           │ POST /wallet/create-transaction
           │ POST /memory/search
           │ GET  /memory/get/:path
           │
           ▼
┌───────────────────────────────────────────────────────────────┐
│ AGIdentity Gateway (Extended)                                  │
│                                                                │
│  src/server/auth-server.ts (Express + BRC-103 auth)           │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │ Existing Endpoints:                                      │  │
│  │ - /vault/*     (vault operations)                        │  │
│  │ - /team/*      (team collaboration)                      │  │
│  │ - /sign        (signature operations)                    │  │
│  │                                                           │  │
│  │ NEW Endpoints (Phase 8):                                 │  │
│  │ - /wallet/balance                                        │  │
│  │ - /wallet/create-transaction                             │  │
│  │ - /wallet/sign-message                                   │  │
│  │ - /memory/search                                         │  │
│  │ - /memory/get/:path                                      │  │
│  └─────────────────────────────────────────────────────────┘  │
│          │                                                     │
│          ▼                                                     │
│  ┌─────────────────┬─────────────────┬──────────────────┐     │
│  │ AgentWallet     │MemoryServer     │ IdentityGate     │     │
│  │ (MPC)           │ (Shad/Local)    │ (Certificates)   │     │
│  └─────────────────┴─────────────────┴──────────────────┘     │
│                                                                │
│  src/gateway/agidentity-openclaw-gateway.ts (WebSocket)       │
│  └─► OpenClaw Gateway (ws://127.0.0.1:18789)                  │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

### Component Reuse Summary

| Component | Existing? | Reuse Strategy |
|-----------|-----------|----------------|
| HTTP Server | ✅ `auth-server.ts` | Extend with wallet/memory endpoints |
| Authentication | ✅ BRC-103/104 middleware | Reuse for plugin auth |
| Session Management | ✅ `activeSessions` Map | Reuse for plugin sessions |
| Wallet Interface | ✅ `AgentWallet` | Expose via new endpoints |
| Memory Server | ✅ `AGIdentityMemoryServer` | Expose via new endpoints |
| HTTP Client | ✅ `AGIDClient` | Use in plugin to call gateway |
| WebSocket Client | ✅ `OpenClawClient` | Keep for chat messaging |

**Code Reuse:** ~95% - Only add endpoints and plugin bridge

---

## Implementation Checklist

### Phase 8: Tool Registry System

**Part 1: Extend Auth Server (AGIdentity Gateway)**
- [ ] Add `memoryServer?: AGIdentityMemoryServer` to `AGIDServerConfig`
- [ ] Add wallet endpoints to `auth-server.ts`:
  - [ ] `GET /wallet/balance`
  - [ ] `POST /wallet/create-transaction`
  - [ ] `POST /wallet/sign-message`
  - [ ] `GET /wallet/network`
- [ ] Add memory endpoints to `auth-server.ts`:
  - [ ] `POST /memory/search`
  - [ ] `GET /memory/get/:path`
- [ ] Test endpoints with existing `AGIDClient`

**Part 2: Create OpenClaw Plugin**
- [ ] Create `extensions/agidentity-tools/` directory
- [ ] Add `package.json` with `openclaw.extensions` field
- [ ] Create `index.ts` with plugin entry point
- [ ] Create `src/api-client.ts` with `AGIDClient` wrapper
- [ ] Create `src/wallet-tools.ts` with:
  - [ ] `agid_get_balance` tool
  - [ ] `agid_create_transaction` tool
- [ ] Create `src/memory-tools.ts` with:
  - [ ] `agid_store_memory` tool
  - [ ] `agid_recall_memory` tool
- [ ] Test plugin registration with OpenClaw

**Part 3: Integration & Testing**
- [ ] Start AGIdentity auth server with memory server
- [ ] Install plugin in OpenClaw `extensions/` directory
- [ ] Configure plugin in OpenClaw `config.json5`
- [ ] Test wallet balance tool
- [ ] Test transaction creation tool
- [ ] Test memory search tool
- [ ] Test memory retrieval tool
- [ ] Verify BRC-103 authentication works
- [ ] Test error handling

**Phase 9: Approval Workflow (Future)**
- [ ] Add approval queue to gateway
- [ ] Add MessageBox approval notifications
- [ ] Add polling/webhook for approval status
- [ ] Update wallet tools to wait for approval
- [ ] Add approval audit logging

---

## Benefits of This Approach

1. **Maximum Code Reuse** - Leverages 95% of existing infrastructure
2. **Consistent Auth** - BRC-103 everywhere, no new auth mechanisms
3. **Single Server** - One Express instance, one port, unified config
4. **Minimal Changes** - Add endpoints, create plugin bridge
5. **Clear Separation** - Plugin is thin adapter, gateway has all logic
6. **Security Isolation** - Wallet/crypto stays in gateway, never exposed
7. **Future-Proof** - Approval workflow slots in cleanly in Phase 9
8. **Testable** - Can test endpoints with existing `AGIDClient`

---

*Analysis completed: 2026-02-15*
*Ready for Phase 8 planning*
