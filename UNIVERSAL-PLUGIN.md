# 🔌 AGIdentity: Universal Plugin for AI Agents

**Give ANY AI agent framework cryptographic identity, encrypted memory, and metanet autonomy.**

## ✅ Status: WORKING!

```bash
# Start service
npx tsx start-api-only.ts

# Test all endpoints
npx tsx test-http-api.ts
# Result: 5/5 PASSED ✅
```

---

## 🎯 The Vision

**AGIdentity is framework-agnostic infrastructure** that gives ANY AI agent:

- ✅ **Onchain Identity** - Unique BSV public key
- ✅ **Cryptographic Signing** - Prove agent actions
- ✅ **Encrypted Memory** - Private agent thoughts
- ✅ **Economic Capability** - Hold and send BSV
- ✅ **P2P Messaging** - Agent-to-agent communication
- ✅ **Metanet Autonomy** - Participate in blockchain economy

**Works with:** OpenClaw, ZeroClaw, PicoClaw, LangChain, AutoGPT, Claude Desktop, custom agents

---

## 🚀 Quick Start (5 minutes)

### 1. Start AGIdentity Service

```bash
# Install dependencies (already done)
npm install

# Configure
cp .env.example .env
# Edit .env: Set AGENT_PRIVATE_KEY

# Start HTTP API server
npx tsx start-api-only.ts
```

**Server running on:** `http://localhost:3000`

### 2. Use From ANY Agent

**JavaScript/TypeScript:**
```typescript
const identity = await fetch('http://localhost:3000/api/identity').then(r => r.json())
console.log(identity.publicKey)  // 0279be667...
```

**Python:**
```python
import requests
identity = requests.get('http://localhost:3000/api/identity').json()
print(identity['publicKey'])  # 0279be667...
```

**cURL:**
```bash
curl http://localhost:3000/api/identity
```

**Any language with HTTP support!**

---

## 📡 Universal API Endpoints

### GET /api/identity
Get agent's cryptographic identity

**Response:**
```json
{
  "success": true,
  "publicKey": "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
  "network": "testnet",
  "balance": 0,
  "utxos": 0,
  "status": "active"
}
```

### POST /api/sign
Sign a message with agent's private key

**Request:**
```json
{
  "message": "I am an autonomous agent",
  "protocol": "agent message"  // optional
}
```

**Response:**
```json
{
  "success": true,
  "message": "I am an autonomous agent",
  "signature": "3045022100c331305045fa6cea...",
  "protocol": "agent message",
  "signed": true
}
```

### POST /api/encrypt
Encrypt data for secure storage

**Request:**
```json
{
  "data": "Secret agent memory",
  "protocol": "agent memory",  // optional
  "keyId": "mem001",           // optional
  "counterparty": "self"       // optional
}
```

**Response:**
```json
{
  "success": true,
  "ciphertext": "52d4642446affe8e77d64d9e...",
  "encrypted": true,
  "protocol": "agent memory",
  "keyId": "mem001"
}
```

### POST /api/decrypt
Decrypt previously encrypted data

**Request:**
```json
{
  "ciphertext": "52d4642446affe8e77d64d9e...",
  "protocol": "agent memory",
  "keyId": "mem001",
  "counterparty": "self"
}
```

**Response:**
```json
{
  "success": true,
  "plaintext": "Secret agent memory",
  "decrypted": true,
  "protocol": "agent memory"
}
```

### GET /api/balance
Check BSV wallet balance

**Response:**
```json
{
  "success": true,
  "balance": 0,
  "satoshis": 0,
  "utxos": 0,
  "network": "testnet"
}
```

---

## 🔌 Integration Examples

### OpenClaw

```typescript
// examples/openclaw-plugin.ts
import { openclawTools } from './examples/openclaw-plugin.js'

const agent = new OpenClaw({
  tools: openclawTools,
  systemPrompt: "You have cryptographic identity on BSV blockchain..."
})

// Agent can now:
// - Call agid_identity to get its public key
// - Call agid_sign to sign messages
// - Call agid_encrypt to store memories
```

### ZeroClaw

```typescript
import { AGIdentityClient } from './examples/simple-client.js'

const identity = new AGIdentityClient()

const zeroclaw = new ZeroClaw({
  capabilities: {
    identity: () => identity.getIdentity(),
    sign: (msg) => identity.sign(msg),
    encrypt: (data) => identity.encrypt(data)
  }
})
```

### PicoClaw

```typescript
// PicoClaw with HTTP service
const picoclaw = new PicoClaw()

picoclaw.addService('agidentity', {
  baseURL: 'http://localhost:3000/api',
  endpoints: ['identity', 'sign', 'encrypt', 'decrypt', 'balance']
})

// Agent uses it
const myIdentity = await picoclaw.call('agidentity', 'identity')
```

### Python (LangChain, AutoGPT, etc.)

```python
# examples/python-client.py
from agidentity_client import AGIdentityClient

agent = AGIdentityClient()

# Any Python agent can now:
identity = agent.get_identity()
signature = agent.sign("Message from Python")
encrypted = agent.encrypt("Secret data")
balance = agent.check_balance()
```

### Claude Desktop (MCP)

```json
// ~/.config/claude/config.json
{
  "mcpServers": {
    "agidentity": {
      "command": "node",
      "args": ["dist/memory/agidentity-memory-server.js"]
    }
  }
}
```

### Custom Agent (Any Language)

```bash
# Bash
IDENTITY=$(curl -s http://localhost:3000/api/identity)
echo $IDENTITY | jq .publicKey

# Ruby
require 'net/http'
identity = JSON.parse(Net::HTTP.get(URI('http://localhost:3000/api/identity')))

# Go
resp, _ := http.Get("http://localhost:3000/api/identity")
json.NewDecoder(resp.Body).Decode(&identity)

# Rust
let identity: Identity = reqwest::get("http://localhost:3000/api/identity")
    .await?.json().await?;
```

**If it has HTTP, it works!**

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────┐
│  ANY AI AGENT FRAMEWORK                     │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐    │
│  │OpenClaw │  │ZeroClaw │  │PicoClaw │    │
│  └────┬────┘  └────┬────┘  └────┬────┘    │
│       │            │             │          │
│  ┌────┴────────────┴─────────────┴─────┐  │
│  │  Simple HTTP Calls                   │  │
│  └──────────────────┬───────────────────┘  │
└────────────────────┬────────────────────────┘
                     │
          HTTP/JSON (Universal Protocol)
                     │
┌────────────────────▼────────────────────────┐
│  AGIdentity HTTP API Service                │
│  📡 http://localhost:3000                   │
│  ┌────────────────────────────────────────┐ │
│  │  GET  /api/identity                    │ │
│  │  POST /api/sign                        │ │
│  │  POST /api/encrypt                     │ │
│  │  POST /api/decrypt                     │ │
│  │  GET  /api/balance                     │ │
│  └────────────────────────────────────────┘ │
└────────────────────┬────────────────────────┘
                     │
┌────────────────────▼────────────────────────┐
│  AGIdentity Core Components                 │
│  • BRC-100 Wallet (Agent Identity)          │
│  • BSV Blockchain (Transactions)            │
│  • Encrypted Vault (UHRP Storage)           │
│  • MessageBox (P2P Messaging)               │
│  • Identity Gate (Certificate Verification) │
└─────────────────────────────────────────────┘
```

---

## 🎯 What This Enables

### 1. Framework Independence
```
Start with OpenClaw → Switch to ZeroClaw later
→ Same identity, same memories, zero migration
```

### 2. Multi-Framework Teams
```
Research Agent (OpenClaw)  ──┐
Writing Agent (ZeroClaw)   ──┼──> Shared AGIdentity
Coding Agent (PicoClaw)    ──┘     Same team identity
```

### 3. Language Agnostic
```
Python for ML → JavaScript for web → Go for systems
All share same AGIdentity service
```

### 4. Future-Proof
```
New agent framework releases?
→ Just HTTP call
→ Works immediately
```

---

## 📋 Deployment Options

### Local Development (Current)
```bash
npx tsx start-api-only.ts
# http://localhost:3000
```

### Production (Docker)
```dockerfile
FROM node:22
WORKDIR /app
COPY . .
RUN npm install && npm run build
CMD ["node", "dist/start.js"]
EXPOSE 3000
```

```bash
docker build -t agidentity .
docker run -p 3000:3000 -e AGENT_PRIVATE_KEY=$KEY agidentity
```

### Systemd Service
```bash
# /etc/systemd/system/agidentity.service
[Service]
ExecStart=/usr/bin/node /opt/agidentity/dist/start.js
Environment="AGENT_PRIVATE_KEY=..."

systemctl enable agidentity
systemctl start agidentity
```

### Cloud Deployment
- **AWS Lambda** - Serverless API
- **Vercel** - Edge functions
- **Railway** - One-click deploy
- **Fly.io** - Global deployment

---

## 🔐 Security Model

### API Access Levels

**Public Endpoints (No Auth):**
- `GET /api/identity` - Anyone can see agent's public key
- `GET /api/balance` - Anyone can check balance
- `GET /health` - Service health

**Private Operations (Agent Only):**
- `POST /api/sign` - Only agent can sign (needs private key)
- `POST /api/encrypt` - Only agent can encrypt
- `POST /api/decrypt` - Only agent can decrypt

**Why this is safe:**
- Public key is meant to be public
- Signing/encryption happens server-side (private key never leaves)
- Each agent runs its own AGIdentity service
- No cross-agent access

### For Multi-Tenant:

Add authentication:
```typescript
// Add API key middleware
app.use('/api/', (req, res, next) => {
  if (req.headers['x-api-key'] !== process.env.API_KEY) {
    return res.status(401).json({ error: 'Invalid API key' })
  }
  next()
})
```

---

## 📊 Test Results

**HTTP API Tests:** 5/5 PASSED ✅

```bash
npx tsx test-http-api.ts
```

**Wallet Tools Tests:** 5/5 PASSED ✅

```bash
npx tsx test-wallet-tools.ts
```

**All capabilities verified working!**

---

## 🎓 Example Workflows

### Workflow 1: Agent Introduces Itself
```
Agent: agid_identity()
Agent: "I am agent 0279be667..."

Agent: agid_sign("Hello, I am an autonomous agent")
Agent: "Here's my signed introduction: 3045022100..."