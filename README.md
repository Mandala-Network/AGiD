# AGIdentity

**Cryptographic Identity for Enterprise AI**

AGIdentity wraps your AI (OpenClaw) with cryptographic identity. Every employee message is verified, every AI response is signed, and all communication is end-to-end encrypted.

```
Employee (BRC-100 Wallet) ──► MessageBox (E2E Encrypted) ──► AGIdentity Gateway ──► OpenClaw AI
                                                                    │
                                                              MPC Wallet
                                                         (signs, can't leak keys)
```

## 📁 Repository Structure

**Reorganized into intuitive layers:**

```
src/
├── 01-core/        # Core (wallet, identity, config)
├── 02-storage/     # Storage (vault, uhrp, memory)
├── 03-gateway/     # Gateway (main system)
├── 04-integrations/# External services
├── 05-interfaces/  # Access methods (HTTP, CLI, SDK)
├── 06-tools/       # ⭐ OpenClaw AI Tools (AI-callable)
└── 07-shared/      # Shared utilities
```

**Key insight:** Only `06-tools/` contains OpenClaw tools. Everything else is infrastructure.

See `src/README.md` for full architecture guide.

---

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/b1narydt/AGIdentity.git
cd AGIdentity/agidentity
npm install

# 2. Configure
cp .env.example .env
# Edit .env (see below for MPC vs Local mode)

# 3. Build and run
npm run build
npm run gateway
```

## Two Modes

### MPC Mode (Production)

The AI uses threshold signatures - it can sign but **cannot leak its private key**, even if prompt-injected.

```bash
# .env for MPC mode
MPC_COSIGNER_ENDPOINTS=http://cosigner1:3001,http://cosigner2:3002
MPC_SHARE_SECRET=<generate: openssl rand -hex 32>
MPC_SHARE_PATH=./agent-mpc-share.json
TRUSTED_CERTIFIERS=03abc...,03def...
```

First run performs DKG (distributed key generation). Subsequent runs restore from the encrypted share.

### Local Mode (Development Only)

Single private key - **do not use in production**.

```bash
# .env for local mode
AGENT_PRIVATE_KEY=<generate: openssl rand -hex 32>
TRUSTED_CERTIFIERS=03abc...,03def...
```

## Environment Variables

```bash
# --- MPC Mode (Production) ---
MPC_COSIGNER_ENDPOINTS=http://host1:3001,http://host2:3002  # Cosigner URLs
MPC_SHARE_SECRET=<64-hex-chars>       # Encrypts local key share
MPC_SHARE_PATH=./agent-mpc-share.json # Where to store share

# --- Local Mode (Development) ---
AGENT_PRIVATE_KEY=<64-hex-chars>      # Single key (insecure)

# --- Common ---
TRUSTED_CERTIFIERS=03abc...,03def...  # CA public keys to trust
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
