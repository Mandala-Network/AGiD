# AGIdentity

**Cryptographic Identity for Enterprise AI**

AGIdentity wraps your AI (OpenClaw) with cryptographic identity. Every employee message is verified, every AI response is signed, and all communication is end-to-end encrypted.

```
Employee (BRC-100 Wallet) ──► MessageBox (E2E Encrypted) ──► AGIdentity Gateway ──► OpenClaw AI
                                                                    │
                                                              MPC Wallet
                                                         (signs, can't leak keys)
```

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/b1narydt/AGIdentity.git
cd AGIdentity/agidentity
npm install

# 2. Configure
cp .env.example .env

# 3. Generate a private key and add to .env
openssl rand -hex 32
# Edit .env: AGENT_PRIVATE_KEY=<paste-key-here>

# 4. Build and run
npm run build
npm run gateway
```

That's it. The gateway is now listening for encrypted messages.

## What You Need

| Requirement | Purpose |
|------------|---------|
| Node.js 22+ | Runtime |
| `.env` with `AGENT_PRIVATE_KEY` | Agent's signing identity |
| `TRUSTED_CERTIFIERS` in `.env` | CA public keys to trust |
| OpenClaw (optional) | AI backend |

## Environment Variables

```bash
# Required
AGENT_PRIVATE_KEY=<64-hex-chars>      # openssl rand -hex 32

# Identity (at least one CA)
TRUSTED_CERTIFIERS=03abc...,03def...  # Comma-separated CA public keys

# Optional
AGID_NETWORK=mainnet                  # or testnet
OPENCLAW_GATEWAY_URL=ws://127.0.0.1:18789
OPENCLAW_GATEWAY_TOKEN=<token>
MESSAGEBOX_HOST=https://messagebox.babbage.systems
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        ENTERPRISE                            │
│                                                              │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐         │
│  │ Employee A   │ │ Employee B   │ │ Employee C   │         │
│  │ BRC-100      │ │ BRC-100      │ │ BRC-100      │         │
│  │ Wallet App   │ │ Wallet App   │ │ Wallet App   │         │
│  └──────┬───────┘ └──────┬───────┘ └──────┬───────┘         │
│         │                │                │                  │
│         └────────────────┼────────────────┘                  │
│                          │                                   │
│                   MessageBox (P2P)                           │
│              BRC-2 ECDH End-to-End Encrypted                 │
│                          │                                   │
│                          ▼                                   │
│  ┌───────────────────────────────────────────────────────┐  │
│  │                 AGIdentity Gateway                     │  │
│  │                                                        │  │
│  │  ┌─────────────┐    ┌──────────────────────────────┐  │  │
│  │  │ Identity    │    │         OpenClaw              │  │  │
│  │  │ Gate        │───►│         (AI Agent)            │  │  │
│  │  │             │    │                               │  │  │
│  │  │ - Verify    │    │  Tools, Skills, Memory        │  │  │
│  │  │   cert      │    │                               │  │  │
│  │  │ - Check     │    └───────────────┬──────────────┘  │  │
│  │  │   revocation│                    │                  │  │
│  │  └─────────────┘                    ▼                  │  │
│  │                     ┌──────────────────────────────┐  │  │
│  │                     │      MPC Wallet               │  │  │
│  │                     │  (AI signs, CAN'T leak keys)  │  │  │
│  │                     └──────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌───────────────────────────────────────────────────────┐  │
│  │           Certificate Authority (MPC-backed)           │  │
│  │     Issues employee certs • Revocation on-chain        │  │
│  └───────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

## Key Security Properties

| Property | How |
|----------|-----|
| **End-to-end encryption** | BRC-2 ECDH between employee wallet and AI |
| **Verified identity** | Employees present certificates, checked against CA |
| **Signed responses** | Every AI response signed with MPC wallet |
| **MPC protection** | AI can't leak its private key, even if prompt-injected |
| **Audit trail** | Every interaction logged with blockchain timestamps |

## Programmatic Usage

```typescript
import { createAGIdentityGateway, createAgentWallet } from 'agidentity';

const wallet = await createAgentWallet({
  privateKey: process.env.AGENT_PRIVATE_KEY,
  network: 'mainnet',
});

const gateway = await createAGIdentityGateway({
  wallet,
  trustedCertifiers: ['03abc...'],
  openclawUrl: 'ws://127.0.0.1:18789',
});

// Gateway is now listening
// Employees send encrypted messages → verified → AI responds → signed
```

## CLI (Employee Side)

```bash
# Show your identity
npm run cli:info

# Chat with the AI agent
npm run cli:chat <agent-pubkey>
```

## MPC Wallet (Production)

For production, use threshold signatures so the AI can never leak its key:

```bash
# Set MPC cosigner endpoints
export MPC_COSIGNER_ENDPOINTS="http://cosigner1:3001,http://cosigner2:3002"
export MPC_SHARE_SECRET="encryption-key-for-share"
export MPC_SHARE_PATH="./agent-share.json"
```

```typescript
import { createProductionMPCWallet } from 'agidentity';

const mpcWallet = await createProductionMPCWallet();
// First run: DKG generates distributed key
// Subsequent runs: Restores from share
```

## Project Structure

```
src/
├── start.ts           # Simple gateway entry point
├── gateway/           # AGIdentityOpenClawGateway
├── wallet/            # BRC-100 + MPC wallet
├── messaging/         # MessageBox client
├── identity/          # Certificate verification
├── openclaw/          # OpenClaw WebSocket client
├── memory/            # MCP memory server
├── shad/              # Semantic memory (Shad)
├── vault/             # Encrypted document storage
├── audit/             # Signed audit trail
└── cli/               # Employee CLI
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run build` | Compile TypeScript |
| `npm run gateway` | Start the gateway |
| `npm run start` | Same as gateway |
| `npm test` | Run tests |
| `npm run cli:info` | Show identity info |
| `npm run cli:chat` | Chat with agent |

## v0.1 Features

- Interface hardening (security fixes, session cleanup)
- MessageBox as primary P2P encrypted channel
- MPC wallet interface with dependency injection
- Production MPC integration (DKG/restore)
- OpenClaw Gateway with identity gate
- Shad semantic memory with auto-retrieval
- Signed audit trail for all interactions

## BRC Standards

| Standard | Purpose |
|----------|---------|
| BRC-2 | ECDH encryption |
| BRC-42 | Key derivation |
| BRC-52 | Identity certificates |
| BRC-100 | Wallet interface |
| BRC-103/104 | HTTP authentication |

## License

MIT

---

**SSL unlocked e-commerce. AGIdentity unlocks enterprise AI.**
