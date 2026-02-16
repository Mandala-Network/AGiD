# ✅ Ready to Test! Just Need API Key

## 🎯 What's Running

```
✅ MPC Wallet (2-of-3 threshold)
   Identity: 02aff5b7f8d1586157dd7bc4354133faeb18ddb21a88c1e068fda7d2792ac9f056

✅ Cosigner 1 (localhost:3001)
✅ Cosigner 2 (localhost:3002)

✅ OpenClaw Gateway (ws://127.0.0.1:18789)
   Model: Claude Opus 4.6

✅ AGIdentity HTTP API (http://localhost:3000)
   Wallet tools available
```

---

## 🔑 One Thing Missing: Anthropic API Key

OpenClaw needs your Anthropic API key to run Claude.

### Set it:

```bash
export ANTHROPIC_API_KEY=sk-ant-...

# Then configure OpenClaw
npx openclaw auth add --provider anthropic --key $ANTHROPIC_API_KEY
```

---

## 🧪 Then Test!

### Test 1: Agent Gets Its Identity

```bash
npx openclaw agent --local --agent main \
  --message "What is your identity? Make an HTTP GET request to http://localhost:3000/api/identity to find out your BSV public key."
```

**Expected:**
- OpenClaw makes HTTP call
- Gets MPC wallet public key
- Responds: "My identity is 02aff5b7..."

### Test 2: Agent Signs a Message

```bash
npx openclaw agent --local --agent main \
  --message "Sign this message: 'I am an autonomous agent' by making an HTTP POST to http://localhost:3000/api/sign with body {message: 'I am an autonomous agent'}"
```

**Expected:**
- OpenClaw calls signing API
- MPC wallet creates threshold signature
- Responds with signature

### Test 3: Agent Encrypts Data

```bash
npx openclaw agent --local --agent main \
  --message "Encrypt this secret: 'My private thought' using HTTP POST to http://localhost:3000/api/encrypt"
```

**Expected:**
- OpenClaw encrypts with MPC wallet
- Returns ciphertext

---

## 🎯 The Complete Vision

Once API key is set:

```
You → OpenClaw Agent
         ↓
    "What is your identity?"
         ↓
    Agent makes HTTP call:
    GET http://localhost:3000/api/identity
         ↓
    AGIdentity MPC Wallet responds:
    { publicKey: "02aff5b7...", network: "mainnet" }
         ↓
    Agent: "My onchain BSV identity is 02aff5b7..."
```

**The AI agent is using the SAME MPC wallet that will authenticate MessageBox messages!**

---

## 📋 System Architecture (Working)

```
┌────────────────────────────────────┐
│  OpenClaw AI Agent                 │
│  (Claude Opus 4.6)                 │
│                                    │
│  Can make HTTP calls to:           │
│  http://localhost:3000/api/*       │
└──────────────┬─────────────────────┘
               │
        HTTP API calls
               │
┌──────────────▼─────────────────────┐
│  AGIdentity HTTP API               │
│  (port 3000)                       │
│                                    │
│  Endpoints:                         │
│  • GET  /api/identity              │
│  • POST /api/sign                  │
│  • POST /api/encrypt               │
│  • POST /api/decrypt               │
└──────────────┬─────────────────────┘
               │
      Uses MPC wallet
               │
┌──────────────▼─────────────────────┐
│  MPC Wallet (2-of-3)               │
│  02aff5b7f8d1586157dd7bc4354133... │
│                                    │
│  Party 1: Agent                    │
│  Party 2: Cosigner (3001)          │
│  Party 3: Cosigner (3002)          │
└────────────────────────────────────┘
```

---

## 🚀 After Testing

Once you confirm OpenClaw + wallet works:

1. **Add proper MCP tools** (better than HTTP calls)
2. **Fix MessageBox + MPC integration** (for P2P)
3. **Connect full gateway** (MessageBox → OpenClaw → Wallet)

But first, let's prove the AI can use the MPC wallet!

---

## ⚡ Quick Start

```bash
# 1. Set API key
export ANTHROPIC_API_KEY=your-key-here

# 2. Configure OpenClaw
npx openclaw auth add --provider anthropic --key $ANTHROPIC_API_KEY

# 3. Test
npx openclaw agent --local --agent main \
  --message "Get your identity from http://localhost:3000/api/identity"
```

---

**Set your ANTHROPIC_API_KEY and let's test!**
