# External Integrations

**Analysis Date:** 2026-02-15

## APIs & External Services

**OpenClaw Gateway (AI Agent Integration):**
- WebSocket-based AI agent communication protocol
  - SDK/Client: WebSocket via `ws` package, custom client in `src/openclaw/openclaw-client.ts`
  - Auth: Token-based authentication in `OPENCLAW_GATEWAY_TOKEN` env var
  - Connection: `OPENCLAW_GATEWAY_URL` configurable WebSocket endpoint
  - Features: Automatic reconnection, request/response pattern, timeout handling
  - Files: `src/openclaw/openclaw-client.ts`, `src/gateway/agidentity-openclaw-gateway.ts`, `src/types/openclaw-gateway.ts`

**MessageBox (P2P Encrypted Messaging):**
- Distributed messaging protocol for agent-to-agent communication
  - SDK/Client: @bsv/message-box-client 2.0.0
  - Auth: BRC-42 encrypted messaging with per-counterparty keys
  - Configuration: `MESSAGEBOX_HOST` (default: https://messagebox.babbage.systems)
  - Files: `src/messaging/messagebox-gateway.ts`, `src/messaging/message-client.ts`, `src/messaging/gated-message-handler.ts`
  - Features: Certificate exchange, identity-gated messages, payment handling

**Shad (Shannon's Daemon - AI Research Tool):**
- Python-based AI research daemon for complex analysis tasks
  - Integration method: Process spawning via Node.js `child_process`
  - Config: `SHAD_PATH`, `SHAD_PYTHON_PATH`, `SHAD_STRATEGY`, `SHAD_MAX_*` limits
  - Files: `src/shad/shad-integration.ts`, `src/shad/shad-temp-executor.ts`, `src/shad/encrypted-vault.ts`
  - Protocol: JSON exchange via stdout/stderr
  - Strategies: software, research, analysis, planning
  - Features: Encrypted vault access, temporary decryption for execution

## Data Storage

**UHRP Storage (Universal Hash Resolution Protocol):**
- Distributed encrypted storage with blockchain timestamping
  - Connection: `UHRP_STORAGE_URL` (default: https://go-uhrp.b1nary.cloud)
  - Client: Custom implementation in `src/uhrp/storage-manager.ts`
  - Features: Document encryption with BRC-42 keys, blockchain timestamp transactions, SHA-256 integrity verification
  - Files: `src/uhrp/storage-manager.ts`, `src/vault/index.ts`

**Local Encrypted Vault:**
- File-based encrypted storage for fast local access
  - Location: Configurable directory (default: `.agid/`)
  - Encryption: AES-256-GCM with per-interaction keys
  - Files: `src/vault/local-encrypted-vault.ts`

**Obsidian Vault Integration (Optional):**
- Second Brain integration for existing Obsidian notes
  - Config: `OBSIDIAN_VAULT_PATH`
  - Purpose: Use Obsidian vault as AI agent context source

**BSV Blockchain Network:**
- Immutable recording and validation layer
  - Networks: mainnet or testnet (via `AGID_NETWORK` env var)
  - Features: Transaction creation/signing, OP_RETURN data encoding, UTXO management, certificate acquisition
  - Files: `src/wallet/agent-wallet.ts`, `src/wallet/mpc-integration.ts`, `src/uhrp/storage-manager.ts`

## Authentication & Identity

**Auth Provider:**
- BRC-103/104 Mutual Authentication
  - Implementation: @bsv/auth-express-middleware 2.0.2
  - Token storage: Session-based with JWT
  - Session management: Server-side tracking in `src/auth/`
  - Files: `src/server/auth-server.ts`

**Certificate Authorities (PKI):**
- Digital identity verification system
  - Config: `TRUSTED_CERTIFIERS` (comma-separated public keys)
  - Integration: Via @bsv/wallet-toolbox certificate APIs
  - Files: `src/identity/certificate-authority.ts`, `src/identity/certificate-verifier.ts`, `src/identity/identity-gate.ts`
  - Purpose: Verify sender identity before processing messages

**MPC (Multi-Party Computation) Signing:**
- Threshold signature scheme for distributed key management
  - Config: `MPC_COSIGNER_ENDPOINTS`, `MPC_SHARE_SECRET`, `MPC_SHARE_PATH`
  - Package: @bsv/wallet-toolbox-mpc (local dev version)
  - Files: `src/wallet/mpc-agent-wallet.ts`, `src/wallet/mpc-integration.ts`
  - Purpose: Production-grade signing without single key exposure

## Monitoring & Observability

**Error Tracking:**
- Not configured (console-based logging only)
  - Current: console.log/warn/error throughout codebase
  - Files: `src/gateway/agidentity-openclaw-gateway.ts`, `src/start.ts`, `src/vault/local-encrypted-vault.ts`

**Analytics:**
- None

**Logs:**
- Console output to stdout/stderr
  - No structured logging framework
  - Logs directory exists but not integrated (untracked in git)

## CI/CD & Deployment

**Hosting:**
- Not configured (manual deployment)
  - Shell scripts exist: `deploy-mpc.sh`, `stop-mpc.sh`, `test-agent.sh` (untracked)

**CI Pipeline:**
- Not configured
  - Tests run locally via `npm test`

## Environment Configuration

**Development:**
- Required env vars: See `.env.example` for full list
  - Core: `AGENT_PRIVATE_KEY`, `AGID_NETWORK`
  - Optional: `OPENCLAW_GATEWAY_URL`, `MESSAGEBOX_HOST`, `SHAD_PATH`
- Secrets location: `.env` file (gitignored)
- Mock/stub services: Testnet mode for BSV blockchain

**Staging:**
- Not configured

**Production:**
- MPC mode enabled via environment variables
- Separate configuration for cosigner endpoints
- Testnet or mainnet blockchain selection

## Webhooks & Callbacks

**Incoming:**
- None

**Outgoing:**
- MessageBox message delivery
  - Endpoint: Configured MessageBox host
  - Verification: BRC-42 signature validation
  - Events: Encrypted message delivery, certificate exchange

---

*Integration audit: 2026-02-15*
*Update when adding/removing external services*
