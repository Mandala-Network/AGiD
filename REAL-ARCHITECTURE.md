# 🏗️ AGIdentity: The REAL Architecture

## 🎯 What You're Actually Building

**AGIdentity Gateway = Authenticated AI Agent with Wallet Capabilities**

```
┌────────────────────────────────────────────────────────────────┐
│  USER (via MessageBox)                                         │
│  Sends encrypted P2P message to agent                          │
└────────────────┬───────────────────────────────────────────────┘
                 │
                 │ Encrypted Message
                 │
┌────────────────▼───────────────────────────────────────────────┐
│  AGIDENTITY GATEWAY (src/gateway/ + src/start.ts)              │
│                                                                 │
│  STEP 1: MessageBox Reception                                  │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ • Receive encrypted message via MessageBox               │ │
│  │ • Decrypt with agent's MPC wallet                        │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                 │
│  STEP 2: Identity Verification                                 │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ • Check sender's certificate                             │ │
│  │ • Verify with IdentityGate                               │ │
│  │ • Reject if not trusted                                  │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                 │
│  STEP 3: OpenClaw AI Processing                                │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ OpenClaw Agent with Wallet Tools:                        │ │
│  │                                                           │ │
│  │ AI Model (Claude/GPT) + Tools:                           │ │
│  │ • agid_sign → Sign with MPC wallet                       │ │
│  │ • agid_create_transaction → Build BSV tx                 │ │
│  │ • agid_create_memory → Store on blockchain               │ │
│  │ • agid_encrypt → Encrypt data                            │ │
│  │ • agid_search_memory → Search vault                      │ │
│  │                                                           │ │
│  │ THE SAME MPC WALLET that authenticated                   │ │
│  │ the message is available to AI as tools!                 │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                 │
│  STEP 4: Sign Response                                         │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ • AI response signed with MPC wallet                     │ │
│  │ • Signature proves authenticity                          │ │
│  │ • Audit trail recorded                                   │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                 │
│  STEP 5: Encrypt & Send                                        │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ • Encrypt response for sender                            │ │
│  │ • Send via MessageBox P2P                                │ │
│  └──────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                 │
                 │ Signed Encrypted Response
                 │
┌────────────────▼───────────────────────────────────────────────┐
│  USER (via MessageBox)                                         │
│  Receives verified response from agent                         │
└────────────────────────────────────────────────────────────────┘
```

**ALL messages authenticated, encrypted, and signed!**

---

## 🔑 Key Components

### 1. MPC Wallet (2-of-3 Threshold)
- **Public Key:** `02aff5b7f8d1586157dd7bc4354133faeb18ddb21a88c1e068fda7d2792ac9f056`
- **Network:** mainnet
- **Security:** Need 2 of 3 parties to sign
- **Used for:**
  - Authenticating MessageBox connection
  - Decrypting incoming messages
  - AI wallet operations (tools)
  - Signing responses
  - Creating blockchain transactions

### 2. MessageBox Gateway
- **File:** `src/messaging/messagebox-gateway.ts`
- **Purpose:** P2P encrypted messaging
- **Status:** Needs wallet funding to initialize
- **Once funded:** Receives encrypted messages from other agents/users

### 3. Identity Gate
- **File:** `src/identity/identity-gate.ts`
- **Purpose:** Verify sender certificates
- **Config:** `TRUSTED_CERTIFIERS` (can be empty for testing)
- **Ensures:** Only trusted entities can interact

### 4. OpenClaw AI
- **Not running yet** - needs setup
- **Will have tools:** wallet operations using MPC wallet
- **Connection:** WebSocket to OpenClaw gateway (ws://127.0.0.1:18789)

### 5. Wallet Tools (for OpenClaw)
- **File:** `src/tools/wallet-tools.ts`
- **Purpose:** Let AI agent use its wallet
- **Tools:** sign, encrypt, create_transaction, create_memory, etc.

---

## 📋 Current Status

| Component | Status | Next Action |
|-----------|--------|-------------|
| MPC Wallet | ✅ Running | Fund with BSV |
| Cosigner 1 | ✅ Healthy (port 3001) | - |
| Cosigner 2 | ✅ Healthy (port 3002) | - |
| HTTP API | ✅ Running (port 3000) | - |
| MessageBox | ❌ Waiting for funds | Send BSV to wallet |
| OpenClaw | ❌ Not installed/running | Install & configure |
| Gateway | 🟡 Partial (no MessageBox yet) | Fund wallet |

---

## 🚀 Next Steps to Complete System

### Step 1: Fund the MPC Wallet ⏳ WAITING

**Send BSV to:**
```
Public Key: 02aff5b7f8d1586157dd7bc4354133faeb18ddb21a88c1e068fda7d2792ac9f056
Network: mainnet
```

**Via MessageBox P2P payment** (as you mentioned)

**Once funded:**
- MessageBox will initialize
- Agent can receive encrypted messages
- Agent can send encrypted responses

### Step 2: Set Up OpenClaw (15 min)

**OpenClaw needs to run separately** as a WebSocket server.

**Install OpenClaw globally:**
```bash
npm install -g openclaw
```

**Start OpenClaw gateway:**
```bash
openclaw gateway --port 18789 --token test-token-123
```

**This creates the WebSocket endpoint** that AGIdentity connects to.

### Step 3: Connect Gateway to OpenClaw (Already Done!)

Your gateway (`src/gateway/agidentity-openclaw-gateway.ts`) already connects:
```typescript
// In .env:
OPENCLAW_GATEWAY_URL=ws://127.0.0.1:18789
OPENCLAW_AUTH_TOKEN=test-token-123
```

### Step 4: Add Wallet Tools to OpenClaw

**This is what we need to do next** - tell OpenClaw about the wallet tools so the AI can use them.

---

## 💡 What the System Will Do (Once Complete)

### Scenario: User Sends Message via MessageBox

```
1. User (via MessageBox app):
   "Hey agent, sign this contract and store it on blockchain"

2. MessageBox → AGIdentity Gateway:
   [Encrypted message arrives]

3. Gateway decrypts with MPC wallet

4. Gateway verifies sender identity

5. Gateway routes to OpenClaw AI:
   "Hey agent, sign this contract and store it on blockchain"

6. OpenClaw AI thinks:
   "I need to sign this and store it"

7. OpenClaw calls tools:
   - agid_sign({ message: "contract text" })
   - agid_create_memory({ content: "contract", onchain: true })

8. Tools use THE SAME MPC wallet to:
   - Create signature via threshold signing
   - Create blockchain transaction with memory token
   - Broadcast to BSV mainnet

9. AI response:
   "Contract signed! Signature: 3045... Stored on blockchain: txid abc123..."

10. Gateway signs response with MPC wallet

11. Gateway encrypts for sender

12. Gateway sends via MessageBox

13. User receives verified encrypted response
```

**Every step authenticated, encrypted, and signed!**

---

## 🔧 What We Need To Complete

### Current State:
- ✅ MPC wallet working (collective pubkey generated)
- ✅ Cosigners running
- ✅ Gateway code exists
- ✅ Wallet tools exist
- ❌ Wallet not funded (can't use MessageBox yet)
- ❌ OpenClaw not running
- ❌ Tools not connected to OpenClaw

### To Complete:
1. **Fund MPC wallet** - You'll do via MessageBox
2. **Install/start OpenClaw** - I'll help (15 min)
3. **Connect wallet tools to OpenClaw** - I'll do this
4. **Test end-to-end** - Full message flow

---

## 🎯 What Do You Want Me To Do?

**Option A:** Wait for you to fund the wallet, then continue

**Option B:** Set up OpenClaw now (can test without MessageBox first)

**Option C:** Explain the complete architecture in detail first

What should I do next?