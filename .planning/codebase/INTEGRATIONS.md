# External Integrations

**Analysis Date:** 2026-02-14

## APIs & External Services

**BSV Blockchain Services:**
- MessageBox (Babbage Systems) - Async agent-to-agent messaging with BRC-2 ECDH encryption
  - SDK/Client: @bsv/message-box-client 2.0.0 (`src/messaging/message-client.ts`)
  - Auth: BRC-103/104 mutual authentication
  - Host: MESSAGEBOX_HOST env var (default: https://messagebox.babbage.systems)

**UHRP Storage:**
- Cloud encrypted document storage with blockchain timestamps
  - Integration: Custom AGIdentityStorageManager (`src/uhrp/storage-manager.ts`)
  - Auth: Wallet-based signing
  - Mainnet: UHRP_MAINNET_RESOLVER (default: https://uhrp.network/resolve)
  - Testnet: UHRP_TESTNET_RESOLVER (default: https://testnet.uhrp.network/resolve)
  - Upload URL: UHRP_STORAGE_URL env var (required for production)

**External APIs:**
- None currently integrated (no Stripe, SendGrid, etc.)

## Data Storage

**Databases:**
- SQLite - Wallet key management and UTXO tracking
  - Connection: AGENT_WALLET_PATH env var (default: ./agent-wallet.sqlite)
  - Client: @bsv/wallet-toolbox Setup.createWalletSQLite()
  - Migrations: Managed by wallet-toolbox

**File Storage:**
- Local encrypted vault - Fast document cache
  - Path: OBSIDIAN_VAULT_PATH env var (e.g., ~/Documents/ObsidianVault)
  - Encryption: AES-256-GCM via BRC-42 derived keys
  - Storage: .agid/ subdirectory for encrypted files

**Caching:**
- In-memory Map for document cache (`src/vault/local-encrypted-vault.ts`)
- VAULT_CACHE_DIR for temporary decrypted documents (default: /tmp/agidentity-vault-cache)

## Authentication & Identity

**Auth Provider:**
- BRC-103/104 Mutual Authentication - Bidirectional signing
  - Implementation: @bsv/auth-express-middleware (`src/server/auth-server.ts`)
  - Token storage: Session-based with public key mapping
  - Session management: SessionManager class (`src/auth/session-manager.ts`)

**Certificate System:**
- BRC-52/53 certificate format and revocation
  - Trusted certifiers: TRUSTED_CERTIFIERS env var (comma-separated public keys)
  - Requirement: REQUIRE_CERTIFICATES env var (default: true)
  - Verification: IdentityGate (`src/identity/identity-gate.ts`)

## Monitoring & Observability

**Error Tracking:**
- None (console logging only)

**Analytics:**
- None

**Logs:**
- Console output with configurable levels
  - AGID_SERVER_LOGGING env var
  - AGID_SERVER_LOG_LEVEL env var
  - MESSAGEBOX_LOGGING env var

## CI/CD & Deployment

**Hosting:**
- Not specified (designed for self-hosting)
- Deployment: npm package distribution

**CI Pipeline:**
- Not detected (no .github/workflows)

## Environment Configuration

**Development:**
- Required env vars: AGENT_PRIVATE_KEY (64-char hex)
- Network: AGID_NETWORK (mainnet/testnet)
- Secrets location: `.env.local` (gitignored)
- Reference: `.env.example` with all options documented

**Staging:**
- Use testnet: AGID_NETWORK=testnet
- Separate wallet: Different AGENT_WALLET_PATH

**Production:**
- Secrets management: Environment variables
- Required: UHRP_STORAGE_URL (your provider)
- Optional: SHAD_PATH, OBSIDIAN_VAULT_PATH

## Webhooks & Callbacks

**Incoming:**
- None (all interactions via authenticated HTTP)

**Outgoing:**
- MessageBox notifications (P2P messaging)
  - Delivery via MessageBoxClient (`src/messaging/message-client.ts`)
  - Encryption: Automatic BRC-2 ECDH

## Shad AI Integration (Optional)

**Shad (Shannon's Daemon):**
- Type: Local Python-based retrieval augmented module (RLM)
  - Invocation: child_process.spawn() (`src/shad/shad-integration.ts`)
  - Command: `python3 -m shad.cli run`
  - Config:
    - SHAD_PATH (default: ~/.shad)
    - SHAD_PYTHON_PATH (default: python3)
    - SHAD_STRATEGY (software/research/analysis/planning)
    - SHAD_MAX_DEPTH, SHAD_MAX_NODES, SHAD_MAX_TIME
  - Integration: Secure HTTP server on random port with /search, /read, /verify, /list endpoints

---

*Integration audit: 2026-02-14*
*Update when adding/removing external services*
