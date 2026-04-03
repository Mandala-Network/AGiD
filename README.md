# AGiD — Auditable Agent Identity

Compliance infrastructure for AI agents. Cryptographic identity, tamper-proof audit trails, end-to-end encrypted communication, and verifiable on-chain memory.

Install as an [OpenClaw plugin](#openclaw-plugin) or run the full [AGiD runtime](#agid-runtime) with self-hosted messaging.

## Architecture

```
CLI / Client
    ↓  Encrypted messages (ECDH)
MessageBox (self-hosted relay)
    ↓  Authenticated WebSocket
AGiD Gateway
    ↓  Plugin system (57 tools)
LLM Provider (Anthropic / Ollama / OpenAI-compatible)
    ↓  Tool execution
Identity Client (sign, pay, certify, prove)
    ↓  Encrypted response
MessageBox → Client
```

The gateway runs a native agent loop iterating between LLM calls and tool execution. Read-only tools execute in parallel. Wallet-mutating tools execute sequentially for signing safety. All 57 tools are registered through the modular plugin system.

## Capabilities

- **Cryptographic Identity** — Every agent gets a unique key pair via the Identity Client. Hierarchical key derivation, identity certificates, and identity overlay resolution.
- **57 Tools** across 11 plugins — identity, crypto, wallet, messaging, memory, audit, certificates, zero-knowledge proofs, deployment, runtime, file system, browser.
- **Encrypted Memory** — On-chain tokens with derived encryption keys. RLM-powered semantic search and deep reasoning.
- **E2E Encrypted Messaging** — Self-hosted MessageBox with ECDH encryption. Authenticated WebSocket for live communication. The relay never sees plaintext.
- **Audit Trail** — Per-session hash chains with Merkle root commitment on-chain. Workspace integrity verification against immutable anchors.
- **Zero-Knowledge Proofs** — Schnorr-based proofs for privileged communication verification, selective session revelation, and content commitments.
- **Certificate System** — Issue, verify, revoke, reveal, and exchange identity certificates.
- **Multi-LLM Support** — Anthropic Claude, Ollama (local), or any OpenAI-compatible endpoint.
- **Infrastructure Deployment** — Deploy and manage projects on Mandala Network nodes directly from agent tools.
- **General-Purpose Execution** — Shell commands, file operations, and headless browser automation.

## OpenClaw Plugin

One install. 57 tools. Zero configuration.

```bash
openclaw plugin install @agid/openclaw-plugin
```

The Identity Client initializes on first use. Keys are generated and persisted locally. Every tool is immediately available.

```bash
openclaw config set agid.network mainnet
openclaw config set agid.storagePath /secure/path/identity.sqlite
```

## AGiD Runtime

Full control. Self-hosted. Air-gappable.

### Prerequisites

- Node.js >= 22.0.0
- Private key (generate with `openssl rand -hex 32`)
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
| `UHRP_STORAGE_URL` | `https://nanostore.babbage.systems` | UHRP storage endpoint |

## Agent Tools

### Identity (5 tools)
| Tool | Description |
|------|-------------|
| `agid_identity` | Get agent's public key, network, and message box status |
| `agid_balance` | Check wallet balance in satoshis |
| `agid_get_public_key` | Derive protocol-specific keys via hierarchical key derivation |
| `agid_get_height` | Get current blockchain block height |
| `agid_lookup_identity` | Look up people on the identity overlay network |

### Crypto (5 tools)
| Tool | Description |
|------|-------------|
| `agid_sign` | Sign messages to prove authorship |
| `agid_encrypt` | Encrypt data for secure storage or communication |
| `agid_decrypt` | Decrypt previously encrypted data |
| `agid_wallet_client_request` | Request user's Identity Client for cryptographic operations |
| `agid_request_user_signature` | Request user signature to prove user authorship |

### Wallet (7 tools)
| Tool | Description |
|------|-------------|
| `agid_create_action` | Create transactions with outputs, baskets, and tags |
| `agid_internalize_action` | Accept incoming transactions |
| `agid_list_outputs` | List wallet outputs filtered by basket and tags |
| `agid_send_payment` | Send payments to another identity |
| `agid_token_create` | Create PushDrop tokens with arbitrary data fields |
| `agid_token_list` | List tokens from wallet baskets |
| `agid_token_redeem` | Redeem tokens to reclaim satoshis |

### Certificates (8 tools)
| Tool | Description |
|------|-------------|
| `agid_cert_issue` | Issue identity certificates to other public keys |
| `agid_cert_receive` | Receive and store incoming certificates |
| `agid_cert_list` | List certificates in wallet |
| `agid_cert_verify` | Verify serialized certificates cryptographically |
| `agid_cert_revoke` | Revoke previously issued certificates |
| `agid_cert_reveal` | Publicly reveal selected certificate fields |
| `agid_cert_check_revocation` | Check on-chain revocation status |
| `agid_cert_send` | Send certificates via MessageBox |

### Zero-Knowledge Proofs (5 tools)
| Tool | Description |
|------|-------------|
| `agid_zkproof_privilege` | Prove privileged communication without revealing content |
| `agid_zkproof_verify` | Verify a zero-knowledge proof |
| `agid_zkproof_selective_reveal` | Reveal one session's key without exposing others |
| `agid_zkproof_commitment` | Create tamper-evident content commitment anchored on-chain |
| `agid_zkproof_verify_commitment` | Verify content matches a previous commitment |

### Messaging (5 tools)
| Tool | Description |
|------|-------------|
| `agid_message_send` | Send encrypted messages via MessageBox |
| `agid_message_list` | List messages in a box (auto-decrypted) |
| `agid_message_ack` | Acknowledge processed messages |
| `agid_list_payments` | List pending incoming payments |
| `agid_accept_payment` | Accept incoming payments |

### Memory (4 tools)
| Tool | Description |
|------|-------------|
| `agid_store_memory` | Encrypt and store memories on-chain |
| `agid_recall_memories` | Recall with optional semantic search |
| `shad_deep_recall` | RLM deep reasoning over stored memories |
| `shad_search_memories` | Fast hybrid keyword + semantic search |

### Audit (2 tools)
| Tool | Description |
|------|-------------|
| `agid_verify_workspace` | Verify workspace file integrity against on-chain anchor |
| `agid_verify_session` | Verify session anchor chain integrity |

### Deploy (8 tools)
| Tool | Description |
|------|-------------|
| `agid_mandala_create_project` | Create a new project on a Mandala Node |
| `agid_mandala_list_projects` | List projects the agent has access to |
| `agid_mandala_project_info` | Get detailed project info |
| `agid_mandala_deploy` | Create deployment and get upload URL |
| `agid_mandala_update_settings` | Update project settings and environment |
| `agid_mandala_project_logs` | View project and resource logs |
| `agid_mandala_manage_admins` | Add, remove, or list project admins |
| `agid_mandala_node_info` | Get public node info |

### Runtime (2 tools)
| Tool | Description |
|------|-------------|
| `exec` | Run shell commands with background process support |
| `process` | Manage background processes (poll, send-keys, submit) |

### File System (4 tools)
| Tool | Description |
|------|-------------|
| `read` | Read a file with optional line range |
| `write` | Write or create a file |
| `edit` | Replace text in a file |
| `apply_patch` | Apply unified diff patches |

### Browser (1 tool)
| Tool | Description |
|------|-------------|
| `browser` | Control headless Chromium (navigate, click, type, screenshot, evaluate) |

### Optimize (1 tool)
| Tool | Description |
|------|-------------|
| `agid_optimize_prompt` | Evolutionary prompt optimization |

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
| `/identity/*` | Mutual auth | Identity operations |
| `/vault/*` | Mutual auth | Vault storage operations |
| `/team/*` | Mutual auth | Team vault operations |

All wallet operations are executed in-process via the plugin registry — no external API surface for wallet actions.

## Docker

```bash
docker build -t agid .

docker run -d \
  -p 3000:3000 \
  -v agid-data:/data \
  -e AGENT_PRIVATE_KEY=<key> \
  -e ANTHROPIC_API_KEY=<key> \
  -e TRUSTED_CERTIFIERS=<keys> \
  agid
```

## Project Structure

```
src/
├── plugins/         # Plugin system (types, registry, API, loader)
│   └── builtin/     # 11 builtin plugins (57 tools)
├── agent/           # Agent loop, prompt builder
│   └── tools/       # Legacy tool index (migrated to plugins)
├── audit/           # Signed audit trail, anchor chains
├── config/          # Configuration loading
├── encryption/      # Encryption helpers
├── gateway/         # MessageBox gateway, agent orchestration
├── identity/        # Certificate verification
├── integrations/    # PeerCert, GEPA, RLM, Mandala
├── messaging/       # MessageBox client, AuthSocket
├── server/          # Authenticated HTTP server
├── startup/         # First-run interactive setup
├── storage/         # Vaults, UHRP, memory manager
├── wallet/          # Identity Client adapter, PushDrop ops
├── types/           # Shared TypeScript types
├── start.ts         # Gateway entry point
└── index.ts         # Public API exports

packages/
└── openclaw-plugin/ # @agid/openclaw-plugin — standalone OpenClaw package
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

- **Authentication**: Mutual authentication for all HTTP endpoints
- **Encryption**: ECDH end-to-end encryption for all MessageBox communication
- **Key Derivation**: Per-counterparty hierarchical key derivation
- **At-Rest Encryption**: AES-256-GCM for local vault storage
- **Audit**: Cryptographic hash chains with on-chain Merkle root anchoring
- **Certificate Enforcement**: Optional mode to reject uncertified senders
- **No External Wallet API**: All wallet operations are in-process only

## License

Open BSV License

---

*Built by BINARY.*
