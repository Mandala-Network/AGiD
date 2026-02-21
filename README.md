# AGIdentity

Autonomous AI agent infrastructure with cryptographic identity, BSV wallet, and encrypted peer-to-peer communication. Every interaction is authenticated, encrypted end-to-end, and signed on-chain.

## Architecture

```
CLI / Client
    ↓  BRC-2 encrypted messages
MessageBox (P2P)
    ↓  AuthSocket WebSocket
AGIdentity Gateway
    ↓  Native agent loop
LLM Provider (Anthropic / Ollama / OpenAI-compatible)
    ↓  Tool execution
BSV Wallet (sign, pay, certify)
    ↓  Encrypted response
MessageBox → Client
```

The gateway runs a native agent loop that iterates between LLM calls and tool execution. Read-only tools execute in parallel; wallet-mutating tools execute sequentially for signing safety. All results are re-ordered to match Anthropic's expected `tool_use_id` ordering.

## Features

- **Cryptographic Identity** — BSV key pair as the agent's root identity. BRC-52/53 certificates for trust establishment.
- **25 Agent Tools** across 9 domains — identity, wallet ops, transactions, tokens, messaging, memory, services, audit, certificates.
- **Encrypted Memory** — On-chain PushDrop tokens with BRC-42 derived encryption keys. Optional semantic search via Shad.
- **E2E Encrypted Messaging** — MessageBox with BRC-2 ECDH encryption. AuthSocket WebSocket for live communication.
- **Audit Trail** — Per-session hash chains with Merkle root commitment on-chain. Workspace integrity verification.
- **Multi-LLM Support** — Anthropic Claude, Ollama (local), or any OpenAI-compatible endpoint.
- **Certificate System** — Issue, verify, revoke, and exchange BRC-52/53 certificates via PeerCert.
- **Mandala Network Integration** — Deploy and manage projects on Mandala Network nodes directly from agent tools.

## Quick Start

### Prerequisites

- Node.js >= 22.0.0
- BSV private key (generate with `openssl rand -hex 32`)
- Anthropic API key (or Ollama / OpenAI-compatible endpoint)

### Install & Run

```bash
npm install
npm run build
npm run gateway
```

On first run, an interactive setup wizard walks through:

1. Private key generation or import
2. Network selection (mainnet / testnet)
3. LLM provider configuration
4. Certificate issuance
5. Workspace file creation

Configuration is persisted to `~/.agidentity/`.

### Manual Configuration

Create `~/.agidentity/.env`:

```bash
AGENT_PRIVATE_KEY=<64-char-hex>
AGID_NETWORK=mainnet
ANTHROPIC_API_KEY=sk-your-key-here
TRUSTED_CERTIFIERS=<comma-separated-public-keys>
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `AGENT_PRIVATE_KEY` | *required* | 64-char hex private key |
| `ANTHROPIC_API_KEY` | — | Anthropic API key |
| `AGID_LLM_PROVIDER` | `anthropic` | `anthropic`, `ollama`, or `openai-compatible` |
| `AGID_MODEL` | `claude-sonnet-4-5-20250929` | Model identifier |
| `AGID_LLM_BASE_URL` | — | Base URL for Ollama / OpenAI-compatible |
| `AGID_LLM_API_KEY` | — | API key for OpenAI-compatible |
| `AGID_NETWORK` | `mainnet` | `mainnet` or `testnet` |
| `AGID_STORAGE_MODE` | `local` | `local` or `remote` |
| `AGID_WORKSPACE_PATH` | `~/.agidentity/workspace/` | Workspace files directory |
| `AGID_SESSIONS_PATH` | `~/.agidentity/sessions/` | Session transcript directory |
| `AGID_MAX_ITERATIONS` | `25` | Max tool-use iterations per request |
| `AGID_MAX_TOKENS` | `8192` | Max tokens per LLM response |
| `AGID_REQUIRE_CERTS` | `false` | Reject messages from uncertified senders |
| `AGID_ALLOW_UNAUTHENTICATED` | `false` | Allow unauthenticated HTTP endpoints |
| `MESSAGEBOX_HOST` | `https://messagebox.babbage.systems` | MessageBox server URL |
| `UHRP_STORAGE_URL` | `https://go-uhrp.b1nary.cloud` | UHRP storage endpoint |

## Agent Tools

### Identity (5 tools)
| Tool | Description |
|------|-------------|
| `agid_identity` | Get agent's public key, network, and balance |
| `agid_balance` | Check BSV wallet balance in satoshis |
| `agid_get_public_key` | Derive protocol-specific keys (BRC-42) |
| `agid_get_height` | Get current blockchain block height |
| `agid_lookup_identity` | Look up people on the BSV identity overlay |

### Wallet Operations (3 tools)
| Tool | Description |
|------|-------------|
| `agid_sign` | Sign messages to prove authorship |
| `agid_encrypt` | Encrypt data for secure storage |
| `agid_decrypt` | Decrypt previously encrypted data |

### Transactions (4 tools)
| Tool | Description |
|------|-------------|
| `agid_create_action` | Create BSV transactions |
| `agid_internalize_action` | Accept incoming transactions |
| `agid_list_outputs` | List wallet UTXOs |
| `agid_send_payment` | Send payments via PeerPay |

### Tokens (3 tools)
| Tool | Description |
|------|-------------|
| `agid_token_create` | Create PushDrop tokens with arbitrary data |
| `agid_token_list` | List tokens from wallet baskets |
| `agid_token_redeem` | Redeem tokens to reclaim satoshis |

### Certificates (8 tools)
| Tool | Description |
|------|-------------|
| `agid_cert_issue` | Issue certificates to other identities |
| `agid_cert_receive` | Receive incoming certificates |
| `agid_cert_list` | List certificates in wallet |
| `agid_cert_verify` | Verify serialized certificates |
| `agid_cert_revoke` | Revoke issued certificates |
| `agid_cert_reveal` | Publicly reveal certificate fields |
| `agid_cert_check_revocation` | Check revocation status |
| `agid_cert_send` | Send certificates via MessageBox |

### Memory (2 tools)
| Tool | Description |
|------|-------------|
| `agid_store_memory` | Store encrypted memories on-chain |
| `agid_recall_memories` | Recall with optional semantic search |

### Messaging (5 tools)
| Tool | Description |
|------|-------------|
| `agid_message_send` | Send encrypted MessageBox messages |
| `agid_message_list` | List messages in a box |
| `agid_message_ack` | Acknowledge processed messages |
| `agid_list_payments` | List incoming payments |
| `agid_accept_payment` | Accept PeerPay payments |

### Services (4 tools)
| Tool | Description |
|------|-------------|
| `agid_optimize_prompt` | GEPA evolutionary prompt optimization |
| `agid_discover_services` | Discover x402 AI services |
| `agid_x402_request` | Authenticated x402 HTTP requests |
| `agid_overlay_lookup` | Query BSV overlay networks |

### Audit (2 tools)
| Tool | Description |
|------|-------------|
| `agid_verify_workspace` | Verify workspace file integrity |
| `agid_verify_session` | Verify anchor chain integrity |

## Workspace Files

The agent's persona and context are defined by workspace files in `~/.agidentity/workspace/`:

| File | Purpose |
|------|---------|
| `SOUL.md` | Core persona, behavioral rules, and values |
| `IDENTITY.md` | Agent's self-description and capabilities |
| `TOOLS.md` | Tool usage guidelines and preferences |
| `MEMORY.md` | Persistent memory context across sessions |

These files are loaded into the system prompt on every request. Edit them to shape the agent's behavior.

## API Endpoints

| Endpoint | Auth | Description |
|----------|------|-------------|
| `GET /` | No | Health check (status, public key, model, uptime) |
| `GET /health` | No | Health check |
| `/identity/*` | BRC-103/104 | Identity operations |
| `/vault/*` | BRC-103/104 | Vault storage operations |
| `/team/*` | BRC-103/104 | Team vault operations |

All wallet operations are executed in-process via the ToolRegistry — no external API surface for wallet actions.

## Docker

```bash
docker build -t agidentity .

docker run -d \
  -p 3000:3000 \
  -v agid-data:/data \
  -e AGENT_PRIVATE_KEY=<key> \
  -e ANTHROPIC_API_KEY=<key> \
  -e TRUSTED_CERTIFIERS=<keys> \
  agidentity
```

## Project Structure

```
src/
├── agent/           # Agent loop, tool registry, prompt builder
│   └── tools/       # 9 domain tool files (25 tools)
├── audit/           # Signed audit trail, anchor chains
├── config/          # Configuration loading
├── encryption/      # Encryption helpers
├── gateway/         # MessageBox gateway, agent orchestration
├── identity/        # Certificate verification
├── integrations/    # PeerCert, GEPA, Shad, Mandala
├── messaging/       # MessageBox client, AuthSocket
├── server/          # BRC-103/104 authenticated HTTP server
├── startup/         # First-run interactive setup
├── storage/         # Vaults, UHRP, memory manager
├── wallet/          # Wallet-toolbox adapter, PushDrop ops
├── types/           # Shared TypeScript types
├── start.ts         # Gateway entry point
└── index.ts         # Public API exports
```

## Development

```bash
npm run build        # Compile TypeScript
npm run dev          # Watch mode
npm test             # Run tests (vitest)
npm run test:watch   # Watch mode tests
npm run lint         # ESLint
npm run format       # Prettier
```

## Security Model

- **Authentication**: BRC-103/104 mutual authentication for all HTTP endpoints
- **Encryption**: BRC-2 ECDH end-to-end encryption for all MessageBox communication
- **Key Derivation**: BRC-42 per-counterparty key derivation
- **At-Rest Encryption**: AES-256-GCM for local vault storage
- **Audit**: Cryptographic hash chains with on-chain Merkle root anchoring
- **Certificate Enforcement**: Optional mode to reject uncertified senders
- **No External Wallet API**: All wallet operations are in-process only

## License

OpenBSV
