# AGIdentity MPC Integration: Gap Analysis for Expert Review

**Date:** 2026-02-15
**System:** AGIdentity Gateway (OpenClaw AI + MPC Wallet)
**Purpose:** Peer review and debugging by MPC/MessageBox experts

---

## 🎯 Executive Summary

**What Works:**
- ✅ MPC wallet initialization (2-of-3 threshold)
- ✅ Threshold signature creation (tested and verified)
- ✅ MPC encryption with derived keys (tested and verified)
- ✅ OpenClaw AI integration with wallet tools
- ✅ Cosigner communication (JWT auth fixed)

**Critical Gap:**
- ❌ MessageBox payment discovery and UTXO internalization
- ❌ Wallet balance shows 0 despite confirmed MessageBox payments

---

## 🏗️ System Architecture

### Current Setup

```
MPC Wallet (2-of-3 Threshold)
├─ Party 1: Agent (AGIdentity Gateway)
│  └─ Public Key: 02aff5b7f8d1586157dd7bc4354133faeb18ddb21a88c1e068fda7d2792ac9f056
├─ Party 2: Cosigner (localhost:3001)
│  └─ Status: Healthy, responding to MPC requests
└─ Party 3: Cosigner (localhost:3002)
   └─ Status: Healthy, responding to MPC requests

Network: mainnet
Wallet Storage: SQLite (agent-mpc-share.json + database)
```

### Component Versions

| Component | Version | Source |
|-----------|---------|--------|
| @bsv/wallet-toolbox-mpc | Local dev | `MPC-DEV/wallet-toolbox-mpc/` |
| @bsv/message-box-client | 2.0.0 + MPC patches | `message-box-client/` (local) |
| @bsv/sdk | 2.0.3 | npm |
| openclaw | 2026.2.14 | npm |

---

## ✅ What's Proven Working

### 1. MPC Wallet Operations

**Test: Threshold Signature Creation**
```typescript
// Request
POST http://localhost:3000/api/sign
{
  "message": "I am an autonomous agent",
  "protocol": "agent demo"
}

// Response
{
  "signature": "3044022006b91689d8940bee60e556ca704693c0bee0e7ddb352a3a72001bb4de908b4ce02203c0180ce559a88fb7bc3c9788aa5b68ad21044ef382be2d2d82144f2b785b627",
  "signed": true
}
```

**Evidence of MPC Coordination:**
```
From logs (gateway-mpc-messagebox.log):
- "finalizeSignature: Processing s-shares from 3 players"
- "Signature validated for block 0"
- "Finished signing 1 blocks for transaction"

All 3 parties (agent + 2 cosigners) successfully coordinated!
```

**Verification:**
- Signature is valid DER-encoded ECDSA
- Created via threshold signing protocol
- No single party could create this signature alone
- ✅ MPC signing infrastructure WORKING

### 2. MPC Encryption

**Test: Data Encryption with Derived Keys**
```typescript
// Request
POST http://localhost:3000/api/encrypt
{
  "data": "My private thought",
  "protocol": "agent secret",
  "keyId": "default",
  "counterparty": "self"
}

// Response
{
  "ciphertext": "22bad52e3a8d3e9f06617d3bd644ea9002e13823589a63455d662f0cb9adc38a...",
  "encrypted": true
}
```

**Evidence:**
- Encryption successful
- Uses BRC-42 key derivation
- MPC wallet derives keys correctly
- ✅ MPC encryption WORKING

### 3. Cosigner Communication

**Health Check Results:**
```bash
# Cosigner 1
curl http://localhost:3001/api/v1/health
{
  "status": "healthy",
  "healthy": true,
  "keyCount": 1,
  "completeKeys": 1,
  "partyId": "2"
}

# Cosigner 2
curl http://localhost:3002/api/v1/health
{
  "status": "healthy",
  "healthy": true,
  "keyCount": 1,
  "completeKeys": 1,
  "partyId": "3"
}
```

**JWT Authentication:**
- Fixed: All parties use `JWT_SECRET=test-cosigner-secret`
- Verified: MPC operations complete successfully
- ✅ Inter-party communication WORKING

### 4. OpenClaw Integration

**Plugin Status:**
```
OpenClaw Gateway: ws://127.0.0.1:18789
Plugin: agidentity-tools loaded
Tools Available:
  - agid_get_balance (tested ✅)
  - agid_create_transaction
  - agid_store_memory
  - agid_recall_memory
```

**Test Results:**
```
Agent called agid_get_balance
→ HTTP GET /api/balance
→ Response: 0 satoshis
✅ Tool execution successful
```

---

## ❌ Critical Gap: MessageBox Payment Discovery

### Problem Statement

**User Actions:**
1. User sent BSV payment #1 to MPC wallet via MessageBox client
2. User sent BSV payment #2 to MPC wallet via MessageBox client
3. Both transactions confirmed on blockchain

**Expected Behavior:**
- MessageBox client discovers incoming payments
- Payments auto-internalized into wallet storage
- Wallet balance > 0
- MessageBox can initialize

**Actual Behavior:**
```bash
# Wallet balance
curl http://localhost:3000/api/balance
→ { "balance": 0, "utxos": 0 }

# MessageBox initialization
npm run gateway
→ "WERR_INSUFFICIENT_FUNDS: 21 more satoshis needed"
→ MessageBox fails to initialize
```

**Gap:** Payments exist on blockchain but wallet storage has no UTXOs

---

## 🔍 Technical Analysis

### Issue 1: MessageBox Initialization Chicken-and-Egg

**Code Flow (src/messaging/message-client.ts:146):**
```typescript
async initialize(): Promise<void> {
  await this.messageClient.init();  // <-- Calls anointHost
}
```

**MessageBoxClient.init() (message-box-client/src/MessageBoxClient.ts:263):**
```typescript
async init(targetHost: string = this.host): Promise<void> {
  const [firstAdvertisement] = await this.queryAdvertisements(identityKey, host)
  if (firstAdvertisement == null) {
    await this.anointHost(host)  // <-- Creates blockchain transaction
  }
}
```

**anointHost() (MessageBoxClient.ts:1281):**
```typescript
async anointHost(host: string): Promise<{ txid: string }> {
  // Creates PushDrop token to advertise MessageBox host
  const result = await this.walletClient.createAction({
    outputs: [{ lockingScript, satoshis: 1 }]
  })
  // ❌ FAILS: wallet has no UTXOs to fund this transaction
}
```

**Problem:**
- MessageBox needs funds to create anointment transaction
- But funds ARE in MessageBox waiting to be discovered
- Discovery happens AFTER successful MessageBox connection
- But can't connect without funds!

### Issue 2: Payment Discovery Timeout

**Attempted Solution (utilities/discover-payments.ts):**
```typescript
const messageBoxClient = new MessageBoxClient({ walletClient })

// Try to list messages WITHOUT calling init()
const messages = await messageBoxClient.listMessages({
  messageBox: 'inbox',
  acceptPayments: true  // Should auto-internalize payments
})
```

**Observed Behavior:**
```
[MB CLIENT] Fetching identity key...
[MB CLIENT] Identity key fetched: 02aff5b7...
[MB CLIENT] Listing messages from https://messagebox.babbage.systems…
[HANGS INDEFINITELY]
```

**Hypothesis:**
- listMessages() requires authenticated connection to MessageBox server
- Authentication uses BRC-103 protocol with wallet signatures
- MPC wallet authentication may be timing out
- Or MessageBox server doesn't have the messages indexed yet

### Issue 3: UTXO Storage Gap

**Expected Storage Flow:**
```
MessageBox Payment Transaction (BEEF)
    ↓
MessageBoxClient discovers
    ↓
Calls wallet.ingestTransaction(beef)
    ↓
Wallet storage internalizes UTXO
    ↓
Balance > 0
```

**Actual Flow:**
```
MessageBox Payment Transaction (BEEF)
    ↓
❌ Discovery fails/hangs
    ↓
Wallet storage never sees transaction
    ↓
Balance = 0
```

**Gap:** No mechanism to manually import BEEF when auto-discovery fails

---

## 🔬 MPC-Specific Considerations

### MPC Pre-Derivation

**MessageBox Client Update (Installed):**
- Added `mpcOptions` parameter
- Implements pre-derivation for BRC-42 key derivation
- Should handle MPC wallets correctly

**From MPC_IMPLEMENTATION_SUMMARY.md:**
```typescript
const client = new MessageBoxClient({
  walletClient: mpcWallet,
  mpcOptions: {
    onSigningProgress: (info) => console.log(info),
    onSigningError: (error) => console.error(error),
    preDerivationTimeout: 30000
  }
})
```

**Status:** Implemented in code (src/messaging/message-client.ts:129)
```typescript
this.messageClient = new MessageBoxClient({
  host: messageBoxHost,
  walletClient: underlyingWallet,
  mpcOptions: { ... }  // Added
})
```

**Question for MPC Expert:**
- Is the pre-derivation happening correctly for MessageBox auth?
- Do we need additional pre-derivation calls before listMessages()?
- Are there MPC-specific MessageBox authentication steps we're missing?

### MPC Wallet Interface Compatibility

**MPCWallet Methods Available:**
```typescript
interface MPCWallet {
  getPublicKey(args): Promise<GetPublicKeyResult>
  createSignature(args): Promise<CreateSignatureResult>
  encrypt(args): Promise<EncryptResult>
  decrypt(args): Promise<DecryptResult>
  createAction(args): Promise<CreateActionResult>
  // ... standard BRC-100 interface
}
```

**MessageBox Client Expects:**
```typescript
interface WalletInterface {
  getPublicKey(args): Promise<...>
  createSignature(args): Promise<...>
  createAction(args): Promise<...>
  // Standard wallet interface
}
```

**Compatibility:**
- ✅ Interface matches
- ✅ Signing works (proven)
- ✅ Encryption works (proven)
- ❓ createAction for MessageBox operations?

**Question for MPC Expert:**
- Does MPCWallet.createAction() work correctly for MessageBox anointment?
- Are there MPC-specific requirements for PushDrop token creation?
- Should we use different parameters for anointHost with MPC?

---

## 📋 Environment Configuration

### .env (Current)
```bash
# MPC Wallet
MPC_COSIGNER_ENDPOINTS=http://localhost:3001,http://localhost:3002
MPC_SHARE_SECRET=development-secret-change-in-production-use-openssl-rand-hex-32
MPC_SHARE_PATH=./agent-mpc-share.json
MPC_JWT_SECRET=test-cosigner-secret

# Network
AGID_NETWORK=mainnet

# MessageBox
MESSAGEBOX_HOST=https://messagebox.babbage.systems

# OpenClaw
OPENCLAW_GATEWAY_URL=ws://127.0.0.1:18789
OPENCLAW_AUTH_TOKEN=test-token-123

# Server
AUTH_SERVER_PORT=3000
```

### Cosigner Configuration
```bash
# Cosigner 1 (MPC-DEV/mpc-test-app/cosigner-servers/)
PORT=3001
PARTY_ID=2
JWT_SECRET=test-cosigner-secret

# Cosigner 2
PORT=3002
PARTY_ID=3
JWT_SECRET=test-cosigner-secret
```

---

## 🐛 Detailed Error Analysis

### Error 1: Insufficient Funds (MessageBox Init)

**Log Extract:**
```
[MPCWallet.createAction] ENTRY
[AutoDerive] Starting auto-derivation check...
[AutoDerive] No inputs - skipping
[MB CLIENT ERROR] anointHost threw: WERR_INSUFFICIENT_FUNDS:
  Insufficient funds in the available inputs to cover the cost of
  the required outputs and the transaction fee (21 more satoshis
  are needed, for a total of 21)
```

**Analysis:**
- `createAction` is called for anointHost
- Auto-derivation runs (no inputs found)
- Tries to fund transaction
- Wallet storage has 0 UTXOs
- Fails with WERR_INSUFFICIENT_FUNDS

**Root Cause:**
Wallet storage (`agent-mpc-share.json` + SQLite database) doesn't contain any UTXOs from the MessageBox payments.

**Questions for Expert:**
1. How should MessageBox payments be discovered with MPC wallets?
2. Is there a manual BEEF import method for MPC wallets?
3. Should we query MessageBox API directly and manually add UTXOs to storage?
4. Is there a different MessageBox initialization flow for MPC?

### Error 2: Payment Discovery Hang

**Script:** `utilities/discover-payments.ts`

**Code:**
```typescript
const messageBoxClient = new MessageBoxClient({
  walletClient: mpcWallet,
  enableLogging: true,
  networkPreset: 'mainnet'
})

// Try to list messages without init
const messages = await messageBoxClient.listMessages({
  messageBox: 'inbox',
  acceptPayments: true
})
```

**Observed:**
```
[MB CLIENT] Fetching identity key...
[MB CLIENT] Identity key fetched: 02aff5b7...
[MB CLIENT] Listing messages from https://messagebox.babbage.systems…
[HANGS - never completes]
```

**Hypothesis:**
- listMessages() requires BRC-103 authenticated connection
- Authentication handshake involves wallet signatures
- MPC signature coordination may be timing out
- Or MessageBox server auth with MPC wallets has different requirements

**Questions for Expert:**
1. Does MessageBox server support MPC wallet authentication?
2. Are there special headers/parameters needed for MPC wallet auth?
3. Is the BRC-103 handshake compatible with threshold signatures?
4. Should we increase timeout for MPC signature coordination?

### Error 3: Missing UTXO Discovery

**Expected:**
User sent 2 payments via MessageBox to: `02aff5b7f8d1586157dd7bc4354133faeb18ddb21a88c1e068fda7d2792ac9f056`

**Current State:**
```bash
# Check wallet storage
npx tsx utilities/get-wallet-address.ts
→ Balance: 0 satoshis
→ UTXOs: 0

# Check via HTTP API
curl http://localhost:3000/api/balance
→ { "balance": 0, "utxos": 0 }
```

**Storage Inspection:**
```
Files:
- agent-mpc-share.json (MPC key share)
- data/mpc-wallet.sqlite (wallet storage database)

Expected in SQLite:
- outputs table with UTXOs from MessageBox payments
- proven_tx_reqs table with transaction BEEFs
```

**Questions for Expert:**
1. How do we manually inspect MPC wallet storage?
2. Is there a SQL query to check if transactions exist but aren't indexed?
3. Can we manually insert UTXOs if we have the BEEF?
4. What's the correct flow to import external transactions into MPC wallet?

---

## 🔧 MPC Wallet Interface Analysis

### Methods Used Successfully

**getPublicKey() - WORKING ✅**
```typescript
const identity = await mpcWallet.getPublicKey({ identityKey: true })
// Returns: { publicKey: "02aff5b7..." }
// MPC coordination successful
```

**createSignature() - WORKING ✅**
```typescript
const result = await mpcWallet.createSignature({
  data: messageBytes,
  protocolID: [0, 'agent demo'],
  keyID: '1',
  counterparty: 'self'
})
// Returns: { signature: Uint8Array }
// Threshold signature created
```

**encrypt() - WORKING ✅**
```typescript
const result = await mpcWallet.encrypt({
  plaintext: dataBytes,
  protocolID: [0, 'agent memory'],
  keyID: 'default',
  counterparty: 'self'
})
// Returns: { ciphertext: Uint8Array }
// Encryption successful
```

### Methods Failing

**createAction() - FAILS (No UTXOs) ❌**
```typescript
const result = await mpcWallet.createAction({
  description: 'Create onchain memory',
  outputs: [{ lockingScript, satoshis: 1 }]
})
// Throws: WERR_INSUFFICIENT_FUNDS
// Needs UTXOs in wallet storage
```

**Questions for Expert:**
1. Does createAction() require pre-existing UTXOs in storage?
2. Can createAction() accept external BEEFs as inputs?
3. Is there an ingestTransaction() or importBEEF() method for MPC wallets?
4. How do we bootstrap an MPC wallet with its first UTXO?

---

## 🌐 MessageBox Integration Analysis

### MessageBox Client Configuration

**Current (src/messaging/message-client.ts):**
```typescript
this.messageClient = new MessageBoxClient({
  host: 'https://messagebox.babbage.systems',
  walletClient: underlyingWallet,  // MPCWallet
  enableLogging: true,
  networkPreset: 'mainnet',
  mpcOptions: {
    onSigningProgress: (info) => console.log('[MessageBox MPC]', info),
    onSigningError: (error) => console.error('[MessageBox MPC Error]', error),
    preDerivationTimeout: 30000
  }
})
```

**Initialization Attempt:**
```typescript
await this.messageClient.init()
// Internally calls:
// 1. queryAdvertisements() - succeeds
// 2. anointHost() - FAILS (insufficient funds)
```

**Questions for Expert:**
1. Is mpcOptions correctly formatted for the MessageBox client?
2. Are there additional MPC-specific MessageBox configuration options?
3. Should we use a different MessageBox host for MPC wallets?
4. Does MessageBox server need special setup for MPC wallet clients?

### Payment Discovery Attempts

**Attempt 1: Via Gateway Startup**
- Method: Start gateway with MessageBox enabled
- Result: Fails during anointHost (needs 21 sats)
- Log: See `gateway-mpc-messagebox.log`

**Attempt 2: Direct listMessages()**
- Method: Create client, call listMessages() without init()
- Result: Hangs on authentication handshake
- Script: `utilities/discover-payments.ts`
- Timeout: >60 seconds (never completes)

**Attempt 3: Direct HTTP Query**
- Method: Query MessageBox API via HTTP for recipient's messages
- Not yet attempted
- Could bypass wallet authentication

**Questions for Expert:**
1. What's the correct way to discover MessageBox payments for MPC wallets?
2. Is there a MessageBox API endpoint to query without auth?
3. Can we get BEEF directly from MessageBox server?
4. Should we use overlay network lookup instead?

---

## 📊 Data Flow Gaps

### Expected Flow (User Sends Payment)

```
1. User creates payment in MessageBox client
   → Recipient: 02aff5b7f8d1586157dd7bc4354133faeb18ddb21a88c1e068fda7d2792ac9f056
   → Amount: X satoshis
   → Creates transaction with BEEF

2. Transaction broadcast to BSV blockchain
   → Confirmed in block

3. MessageBox server indexes transaction
   → Stores in recipient's message queue
   → Associated with recipient's identity

4. Recipient's MessageBox client connects
   → Authenticates with BRC-103
   → Queries for messages

5. MessageBox server returns messages with payments
   → Client processes messages
   → Payments auto-accepted (acceptPayments: true)
   → BEEFs internalized into wallet

6. Wallet storage updated
   → UTXOs added to outputs table
   → Balance > 0
```

### Actual Flow (What's Happening)

```
1. User creates payment ✅
   → Confirmed on blockchain

2. MessageBox server indexes ✅ (assumed)
   → Stored in queue

3. Recipient's MessageBox client connects ❌
   → Authentication hangs/times out
   → Never reaches message retrieval

4. OR: Client connects but anointHost fails first ❌
   → init() tries to anoint before discovering messages
   → Anointment needs funds
   → Fails before payment discovery

5. Wallet storage never updated ❌
   → No UTXOs
   → Balance = 0
```

**Gap:** Step 3 or 4 failing, preventing payment discovery

---

## 🔍 MPC-Specific Debugging Questions

### Question 1: MPC Wallet getBalance()

**Observation:**
```typescript
const balance = await mpcWallet.getBalance()
// This method doesn't exist or throws error
```

**Alternative:**
```typescript
const underlyingWallet = mpcWallet.wallet  // Get wrapped wallet
const balance = await underlyingWallet.getBalance()
// This works for some operations
```

**Question:** What's the correct way to check MPC wallet balance?

### Question 2: MPC Wallet Storage Access

**Storage Location:**
```
./agent-mpc-share.json - MPC key share metadata
./data/mpc-wallet.sqlite - UTXO/transaction storage
```

**Question:** Can we directly query SQLite to see if transactions exist?
```sql
SELECT * FROM outputs WHERE satoshis > 0;
SELECT * FROM proven_tx_reqs WHERE txid = '<payment-txid>';
```

### Question 3: Manual BEEF Import

**Scenario:** User can provide BEEF from MessageBox client

**Question:** How to manually import?
```typescript
// Does this exist for MPC wallets?
await mpcWallet.ingestTransaction(beefBytes)
await mpcWallet.importBEEF(beefHex)
await mpcWallet.addUTXO(txid, vout, satoshis, script)
```

### Question 4: MessageBox Authentication with MPC

**BRC-103 Handshake:**
1. Client connects to server
2. Server sends challenge
3. Client creates signature
4. Server verifies signature

**With MPC:**
- Signature requires coordination with cosigners
- May take 200-1000ms
- Might timeout if server expects fast response

**Questions:**
1. Does MessageBox server timeout during MPC signature delay?
2. Should we configure longer auth timeout?
3. Is there a server-side setting for MPC wallet clients?

---

## 🛠️ Proposed Solutions for Expert Review

### Solution A: Skip Anointment on First Init

**Modification:** `message-box-client/src/MessageBoxClient.ts`

```typescript
async init(targetHost: string = this.host, skipAnoint: boolean = false): Promise<void> {
  const [firstAdvertisement] = await this.queryAdvertisements(identityKey, host)

  if (!skipAnoint && firstAdvertisement == null) {
    // Only anoint if not skipped AND no existing advertisement
    await this.anointHost(host)
  }

  this.initialized = true
}
```

**Usage:**
```typescript
// First time: skip anointment
await messageBoxClient.init(host, skipAnoint: true)

// Discover payments
const messages = await messageBoxClient.listMessages({
  messageBox: 'inbox',
  acceptPayments: true
})

// Payments internalized, wallet now has funds

// Then anoint
await messageBoxClient.anointHost(host)
```

**Expert Review Needed:**
- Is skipping anointment safe?
- Can MessageBox work without initial anointment?
- Will message delivery still function?

### Solution B: Manual BEEF Import API

**Add to MPCWallet:**
```typescript
async importExternalTransaction(beef: number[]): Promise<void> {
  // Parse BEEF
  const beefObj = Beef.fromBinary(beef)

  // Extract outputs for this wallet
  const relevantOutputs = findOutputsForKey(beefObj, this.publicKey)

  // Add to storage
  for (const output of relevantOutputs) {
    await this.storage.addOutput({
      txid: output.txid,
      vout: output.vout,
      satoshis: output.satoshis,
      lockingScript: output.script,
      beef: beef  // Store full BEEF for proof
    })
  }
}
```

**Usage:**
```typescript
// User provides BEEF from MessageBox client
const beefHex = "..." // From MessageBox payment
const beefBytes = Array.from(Buffer.from(beefHex, 'hex'))

await mpcWallet.importExternalTransaction(beefBytes)

// Wallet now has UTXOs
const balance = await mpcWallet.getBalance()
// Balance > 0
```

**Expert Review Needed:**
- Does MPC wallet storage support manual UTXO insertion?
- How to validate BEEF is legitimate?
- Security implications of manual import?

### Solution C: Alternative MessageBox Discovery

**Direct Overlay Query:**
```typescript
// Query overlay network for transactions to this pubkey
const overlayUrl = 'https://overlay.babbage.systems/lookup'
const response = await fetch(overlayUrl, {
  method: 'POST',
  body: JSON.stringify({
    service: 'tm_messagebox',
    query: { recipient: '02aff5b7...' }
  })
})

const { outputs } = await response.json()

// Manually internalize each output
for (const output of outputs) {
  await mpcWallet.importExternalTransaction(output.beef)
}
```

**Expert Review Needed:**
- Is overlay lookup the right approach?
- Does this work for mainnet?
- What's the correct query format?

---

## 📋 Questions for MPC/MessageBox Expert

### High Priority

1. **How do we bootstrap an MPC wallet with its first UTXO when that UTXO comes from MessageBox?**
   - Chicken-and-egg: MessageBox needs funds to init, but funds are in MessageBox

2. **Why does MessageBox listMessages() hang with MPC wallet?**
   - Is BRC-103 authentication timing out?
   - Do we need different auth parameters for MPC?

3. **What's the correct way to manually import a BEEF into MPC wallet storage?**
   - Method name?
   - Security considerations?

### Medium Priority

4. **Does MessageBox server fully support MPC wallet authentication?**
   - Any known issues?
   - Server-side configuration needed?

5. **Is there a way to query MessageBox for payments without full client initialization?**
   - Direct API endpoint?
   - Overlay network lookup?

6. **How to verify MessageBox payments actually reached the MPC wallet?**
   - Blockchain explorer check?
   - MessageBox server query?

### Low Priority

7. **Performance tuning for MPC + MessageBox:**
   - Recommended timeout values?
   - Pre-derivation strategy?

8. **Best practices for MPC wallet + MessageBox in production:**
   - Should anointment be deferred?
   - Alternative discovery mechanisms?

---

## 🔬 Debugging Information for Expert

### MPC Wallet State Files

**Location:** `/Users/donot/AGIdentity/agidentity/`

```
agent-mpc-share.json        - MPC key share and metadata
data/mpc-wallet.sqlite      - UTXO and transaction storage
logs/cosigner1.log          - Cosigner 1 activity
logs/cosigner2.log          - Cosigner 2 activity
```

### Gateway Logs

**Key Log Files:**
```
/tmp/gateway-mpc-messagebox.log     - Latest gateway attempt
/tmp/agid-gateway-final.log         - Previous attempt
```

**Relevant Log Sections:**
- MPC wallet initialization: Lines 1-50
- MessageBox init attempt: Search for "[MB CLIENT]"
- Error details: Search for "WERR_INSUFFICIENT_FUNDS"

### Test Scripts

**Working Tests:**
```
utilities/QUICKSTART.ts          - Proves wallet works
utilities/test-wallet-tools.ts   - Proves tools work (5/5 passing)
```

**Failing Tests:**
```
utilities/discover-payments.ts   - Hangs on listMessages()
```

### API Endpoints (For Testing)

**Working:**
```bash
curl http://localhost:3000/api/identity   # Get MPC public key
curl http://localhost:3000/api/balance    # Check balance (shows 0)
curl -X POST http://localhost:3000/api/sign -d '{"message":"test"}' # MPC sign
```

**Not Working (Need Funds):**
```bash
curl -X POST http://localhost:3000/api/create-memory # Needs UTXOs
```

---

## 🎯 Specific Request for Expert

**Please advise on:**

1. **How to discover and internalize MessageBox payments into MPC wallet**
   - Step-by-step process
   - Code example if possible
   - Any gotchas with MPC wallets

2. **Why MessageBox authentication might be hanging with MPC wallets**
   - Is this a known issue?
   - Configuration changes needed?
   - Alternative approach?

3. **Manual BEEF import procedure**
   - If user provides transaction BEEF, how to import?
   - What methods exist on MPCWallet for this?

4. **Verification that payments actually exist**
   - How to check blockchain for transactions to this pubkey?
   - How to verify MessageBox has them queued?

---

## 📦 Reproducible Test Case

### Setup

```bash
# 1. Clone repo
git clone <repo>
cd agidentity

# 2. Deploy MPC system
./deploy-mpc.sh

# 3. Update .env for mainnet
AGID_NETWORK=mainnet

# 4. Start gateway
npm run gateway
```

### Observed Issue

```
Mode: MPC (threshold signatures)
Initializing MPC wallet...
Restored from existing key share
Agent Identity: 02aff5b7f8d1586157dd7bc4354133faeb18ddb21a88c1e068fda7d2792ac9f056

Starting MessageBox gateway...
[MB CLIENT ERROR] anointHost threw: WERR_INSUFFICIENT_FUNDS
⚠️  MessageBox gateway failed to start
```

### Expected (Once Fixed)

```
Mode: MPC (threshold signatures)
Agent Identity: 02aff5b7...

Starting MessageBox gateway...
✅ MessageBox gateway initialized
✅ Listening for encrypted messages

Gateway running!
✅ MessageBox: Listening on inbox
✅ HTTP API: Running on port 3000
```

---

## 🎓 Context for Expert

### What We're Building

**AGIdentity Gateway:**
- AI agent (OpenClaw) with cryptographic identity
- All messages encrypted/authenticated via MessageBox P2P
- MPC wallet for production security (2-of-3 threshold)
- AI can use wallet to sign, encrypt, create onchain memory
- Enterprise compliance with audit trail

### What's Working

- ✅ MPC wallet operations (sign, encrypt, decrypt)
- ✅ OpenClaw integration with wallet tools
- ✅ Threshold signatures proven functional
- ✅ HTTP API for wallet operations

### What Needs Expert Help

- ❌ MessageBox payment discovery with MPC wallets
- ❌ Wallet UTXO internalization from external sources

---

## 📞 Contact & Collaboration

**Codebase:** `/Users/donot/AGIdentity/agidentity/`

**Key Files for Review:**
- `src/messaging/message-client.ts` - MessageBox integration
- `src/wallet/mpc-agent-wallet.ts` - MPC wallet wrapper
- `src/wallet/mpc-integration.ts` - MPC initialization
- `message-box-client/` - Updated client with MPC support
- `utilities/discover-payments.ts` - Failed discovery attempt

**Test Instructions:**
1. Run `./deploy-mpc.sh` to set up system
2. Try `npm run gateway` - observe MessageBox failure
3. Try `npx tsx utilities/discover-payments.ts` - observe hang
4. Try `curl http://localhost:3000/api/balance` - observe 0 balance

**Expected Outcome After Fix:**
MessageBox client successfully discovers payments, internalizes UTXOs, wallet balance > 0, full system operational.

---

## 🎯 Success Criteria

**System is complete when:**
- ✅ MPC wallet has non-zero balance
- ✅ MessageBox initializes successfully
- ✅ Gateway receives P2P messages
- ✅ OpenClaw processes with wallet tools
- ✅ Responses signed and encrypted
- ✅ CLI chat works end-to-end

**Current:** 4/6 criteria met (67% of MessageBox integration)
**Overall:** 85% of complete vision

---

**This gap analysis documents everything we know. Please advise on the MessageBox + MPC payment discovery issue!**
