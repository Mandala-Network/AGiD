# AGIdentity

**Cryptographic Identity for Autonomous AI Agents**

AGIdentity gives your AI agent a cryptographic identity backed by MPC threshold signatures. Every user message is verified, every AI response is signed, and all communication is end-to-end encrypted.

```
User (BRC-100 Wallet) --> MessageBox (E2E Encrypted) --> AGIdentity Gateway --> Native Agent Loop (LLM)
                                                                |
                                                          MPC Wallet
                                                     (signs, can't leak keys)
```

## Repository Structure

```
src/
├── wallet/          # BRC-100 + MPC wallet, PushDrop token ops
├── identity/        # Certificate authority, verification, identity gate
├── config/          # Environment config
├── storage/         # Vault, UHRP blockchain storage, memory system
├── agent/           # Agent loop, tool registry, LLM providers, prompt builder
│   └── tools/       # 25 declarative agent tools (8 domain files)
├── gateway/         # AGIdentity gateway (orchestrates agent + messaging)
├── messaging/       # MessageBox client, conversation manager
├── encryption/      # Per-interaction encryption helpers
├── integrations/    # External services (Shad, x402, overlay, GEPA, team vault)
├── server/          # BRC-103/104 authenticated HTTP API
├── client/          # Authenticated HTTP client SDK
├── cli/             # Employee-side CLI (chat REPL)
├── types/           # Shared type definitions
├── audit/           # Anchor chain, signed audit trail, workspace integrity
├── index.ts         # Public API exports
└── start.ts         # Gateway startup script
```

See `src/README.md` for the full architecture guide.

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
ANTHROPIC_API_KEY=sk-ant-...
```

First run performs DKG (distributed key generation). Subsequent runs restore from the encrypted share.

### Local Mode (Development Only)

Single private key - **do not use in production**.

```bash
# .env for local mode
AGENT_PRIVATE_KEY=<generate: openssl rand -hex 32>
TRUSTED_CERTIFIERS=03abc...,03def...
ANTHROPIC_API_KEY=sk-ant-...
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
ANTHROPIC_API_KEY=sk-ant-...          # Required for native agent loop
AGID_MODEL=claude-sonnet-4-5-20250929 # LLM model (default)
AGID_MAX_ITERATIONS=25               # Max tool-use iterations per request
AGID_MAX_TOKENS=8192                 # Max tokens per LLM response
TRUSTED_CERTIFIERS=03abc...,03def... # CA public keys to trust
AGID_NETWORK=mainnet                 # or testnet
MESSAGEBOX_HOST=https://messagebox.babbage.systems
AGID_ALLOW_UNAUTHENTICATED=false     # HTTP API auth (default: false)
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
│                          v                                   │
│  ┌───────────────────────────────────────────────────────┐  │
│  │                 AGIdentity Gateway                     │  │
│  │                                                        │  │
│  │  ┌─────────────┐    ┌──────────────────────────────┐  │  │
│  │  │ Identity    │    │     Native Agent Loop         │  │  │
│  │  │ Gate        │───>│     (Anthropic API)           │  │  │
│  │  │             │    │                               │  │  │
│  │  │ - Verify    │    │  25 Tools (8 domain files)    │  │  │
│  │  │   cert      │    │  Parallel read-only execution │  │  │
│  │  │ - Check     │    └───────────────┬──────────────┘  │  │
│  │  │   revocation│                    │                  │  │
│  │  └─────────────┘                    v                  │  │
│  │                     ┌──────────────────────────────┐  │  │
│  │                     │      MPC Wallet               │  │  │
│  │                     │  (AI signs, CAN'T leak keys)  │  │  │
│  │                     └──────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌───────────────────────────────────────────────────────┐  │
│  │           Certificate Authority (MPC-backed)           │  │
│  │     Issues employee certs - Revocation on-chain        │  │
│  └───────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

## Agent Tools

The native agent loop exposes 25 tools across 8 domains, defined declaratively in `src/agent/tools/`:

| Domain | Tools | Wallet Required |
|--------|-------|-----------------|
| **Identity** | `agid_identity`, `agid_balance`, `agid_get_public_key`, `agid_get_height` | No |
| **Wallet Ops** | `agid_sign`, `agid_encrypt`, `agid_decrypt` | Yes |
| **Transactions** | `agid_create_action`, `agid_internalize_action`, `agid_send_payment`, `agid_list_outputs` | Mixed |
| **Tokens** | `agid_token_create`, `agid_token_list`, `agid_token_redeem` | Mixed |
| **Messaging** | `agid_message_send`, `agid_message_list`, `agid_message_ack` | Mixed |
| **Memory** | `agid_store_memory`, `agid_recall_memories` | Mixed |
| **Services** | `agid_optimize_prompt`, `agid_discover_services`, `agid_x402_request`, `agid_overlay_lookup` | Mixed |
| **Audit** | `agid_verify_workspace`, `agid_verify_session` | No |

Read-only tools execute in parallel. Wallet tools execute sequentially to respect the MPC signing lock.

## Key Security Properties

| Property | How |
|----------|-----|
| **End-to-end encryption** | BRC-2 ECDH between employee wallet and AI |
| **Verified identity** | Employees present certificates, checked against CA |
| **Signed responses** | Every AI response signed with MPC wallet |
| **MPC protection** | AI can't leak its private key, even if prompt-injected |
| **Audit trail** | Per-session hash chain with Merkle root anchored on-chain |
| **Workspace integrity** | Workspace files verified against on-chain anchors |

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
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
});

// Gateway is now listening on MessageBox
// Employees send encrypted messages -> verified -> AI responds -> signed
```

## CLI (Employee Side)

```bash
# Chat with the AI agent
npm run cli:chat <agent-pubkey>
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run build` | Compile TypeScript |
| `npm run gateway` | Start the gateway |
| `npm run start` | Same as gateway |
| `npm test` | Run tests |
| `npm run cli:chat` | Chat with agent |

## BRC Standards

| Standard | Purpose |
|----------|---------|
| BRC-2 | ECDH encryption |
| BRC-42 | Key derivation |
| BRC-48 | PushDrop tokens (on-chain memory) |
| BRC-52 | Identity certificates |
| BRC-100 | Wallet interface |
| BRC-103/104 | HTTP authentication |

## License

MIT
