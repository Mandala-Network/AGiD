# Architecture

**Analysis Date:** 2026-02-15

## Pattern Overview

**Overall:** Modular Layered Architecture with Plugin System

**Key Characteristics:**
- Service-oriented composition wrapping OpenClaw (AI agent framework)
- Cryptographic foundation layer with blockchain-backed identity
- Multi-tiered encrypted storage (local + distributed)
- Plugin architecture for AI agent integration
- Clear separation between cryptography, storage, messaging, and application layers

## Layers

**Wallet & Cryptography Layer:**
- Purpose: BRC-100 compatible wallet for agent identity and signing
- Contains: `AgentWallet`, `MPCAgentWallet`, `PerInteractionEncryption`, `SessionEncryption`
- Location: `src/wallet/`, `src/encryption/`
- Depends on: @bsv/wallet-toolbox, cryptographic primitives
- Used by: All layers requiring signing, encryption, or identity operations

**Identity & Verification Layer:**
- Purpose: Cryptographic identity verification using BRC-52/53 certificates
- Contains: `IdentityGate`, `CertificateAuthority`, `CertificateVerifier`
- Location: `src/identity/`
- Depends on: Wallet layer for certificate operations
- Used by: Server, messaging, gateway (gates all operations)

**Storage & Vault Layer:**
- Purpose: Multi-tiered encrypted storage with blockchain timestamps
- Contains: `AGIdentityStorageManager` (UHRP), `LocalEncryptedVault`, `EncryptedShadVault`
- Location: `src/vault/`, `src/uhrp/`, `src/shad/`
- Depends on: Wallet layer for encryption keys, BSV blockchain for timestamps
- Used by: Memory layer, gateway, CLI tools

**Memory & Reasoning Layer:**
- Purpose: AI agent long-term memory with encryption and garbage collection
- Contains: `AGIdentityMemoryServer`, `MemoryWriter`, `MemoryReader`, `MemoryGarbageCollector`
- Location: `src/memory/`
- Depends on: Vault layer for storage, encryption layer
- Used by: OpenClaw gateway for context injection

**Communication Layer:**
- Purpose: P2P messaging and AI agent communication
- Contains: `MessageBoxGateway`, `AGIDMessageClient`, `GatedMessageHandler`, `OpenClawClient`
- Location: `src/messaging/`, `src/openclaw/`
- Depends on: Identity layer for verification, encryption layer
- Used by: Gateway, service facade

**Server & API Layer:**
- Purpose: HTTP API with BRC-103/104 mutual authentication
- Contains: `AGIDServer`, `AGIDClient`
- Location: `src/server/`, `src/client/`
- Depends on: Identity layer for auth, vault layer for operations
- Used by: External clients, tools

**Service Integration Layer:**
- Purpose: Unified composition of all components
- Contains: `AGIdentityService`, `AGIdentityOpenClawGateway`
- Location: `src/service/`, `src/gateway/`
- Depends on: All layers
- Used by: Entry points (start.ts, CLI)

**Configuration & Bootstrap Layer:**
- Purpose: Centralized environment-based configuration loading
- Contains: `loadConfig()`, `getConfig()`, `validateConfig()`
- Location: `src/config/`
- Depends on: Environment variables, dotenv
- Used by: All layers for initialization

**CLI & Tools Layer:**
- Purpose: Command-line interface and self-awareness tools for agents
- Contains: CLI commands (info, chat), identity tools
- Location: `src/cli/`, `src/tools/`
- Depends on: Service layer
- Used by: End users, agents

## Data Flow

**Incoming Message Flow (MessageBox → OpenClaw):**

1. User sends encrypted message via MessageBox
2. `MessageBoxGateway.processMessage()` receives and routes
3. `GatedMessageHandler.verifyIdentity()` checks sender certificates
4. `ConversationManager.trackContext()` manages session threading
5. `AGIdentityOpenClawGateway.forward()` prepares for AI processing
6. `OpenClawClient.sendChat()` forwards to AI agent
7. `AGIdentityMemoryServer.retrieve()` optionally injects vault context
8. OpenClaw executes (with wallet available for signing operations)
9. `SignedAuditTrail.record()` logs interaction
10. Response encrypted with `PerInteractionEncryption`
11. Encrypted response returned to user

**Document Upload/Storage Flow:**

1. Document received (plaintext)
2. `PerInteractionEncryption.encryptMessage()` with unique key per interaction
3. `AGIdentityStorageManager.uploadVaultDocument()`:
   - Derive BRC-42 encryption key (level 2 per-counterparty)
   - Encrypt with AES-256-GCM
   - Calculate SHA-256 content hash
   - Upload to UHRP provider
   - Create blockchain timestamp transaction
4. Returns `UHRPDocument` with hash (uhrp://...) and onchain proof

**Agent Identity & Signing Flow:**

1. Tool execution request received
2. `IdentityGate.verifyIdentity()` checks caller certificates
3. `AgentWallet.createSignature()` or `MPCAgentWallet.createSignature()`:
   - If MPC mode: Threshold signature across cosigners
   - If local mode: Single key signature
4. Signed transaction/message returned

**State Management:**
- Stateless for HTTP requests (session tracking via JWT)
- Stateful for WebSocket connections (OpenClawClient maintains connection)
- Persistent state in encrypted vaults (local or UHRP)
- In-memory caching for certificates and conversation context

## Key Abstractions

**BRC100Wallet Interface:**
- Purpose: Standardized wallet operations across implementations
- Examples: `src/wallet/agent-wallet.ts`, `src/wallet/mpc-agent-wallet.ts`
- Pattern: Interface implementation with local or distributed backing
- Methods: getPublicKey, encrypt/decrypt, createSignature, createAction, certificate management

**Vault Abstraction:**
- Purpose: Pluggable storage backends with encryption
- Examples: `src/vault/local-encrypted-vault.ts`, `src/shad/encrypted-vault.ts`
- Pattern: Common interface for encrypt, decrypt, read, write, search, list

**Service Composition Pattern:**
- Purpose: Single entry point for all AGIdentity functionality
- Example: `AGIdentityService` in `src/service/agidentity-service.ts`
- Pattern: Facade composing wallet, storage, vault, encryption, identity gate, server, messaging

**Message Gateway Pattern:**
- Purpose: Route and process messages with identity verification
- Example: `MessageBoxGateway` → `VerifiedMessage` → `MessageResponse`
- Pattern: Pipeline with identity gating and encryption

**Encryption Strategy Pattern:**
- Purpose: Multiple encryption approaches for different use cases
- Examples: `PerInteractionEncryption` (PFS), `SessionEncryption`, `LocalEncryptedVault` (at-rest)
- Pattern: Strategy pattern for swappable encryption methods

## Entry Points

**Main Module Export (`src/index.ts`):**
- Location: `src/index.ts`
- Triggers: Import by external code
- Responsibilities: Export `createAGIdentity(config)` factory, individual component exports, plugin export

**Gateway/Server Entry (`src/start.ts`):**
- Location: `src/start.ts`
- Triggers: `npm run gateway` or `npm run start`
- Responsibilities: Initialize wallet (MPC or local), start MessageBox gateway, start HTTP server, handle graceful shutdown

**CLI Entry (`src/cli/index.ts`):**
- Location: `src/cli/index.ts` (executable: `bin/agid` in package.json)
- Triggers: User runs `agid <command>`
- Responsibilities: Parse CLI arguments, execute commands (info, chat), display results

**HTTP API Entry (`src/server/auth-server.ts`):**
- Location: `src/server/auth-server.ts`
- Triggers: HTTP requests on port 3000 (configurable)
- Responsibilities: BRC-103/104 authentication, vault operations, certificate management

## Error Handling

**Strategy:** Throw exceptions, catch at boundaries, log and respond appropriately

**Patterns:**
- Services throw Error with descriptive messages
- HTTP handlers catch at route level, return appropriate status codes
- WebSocket clients handle connection errors with reconnection logic
- Validation errors fail fast with clear error messages

## Cross-Cutting Concerns

**Logging:**
- Console.log for normal output
- Console.error/warn for errors and warnings
- No structured logging framework (identified in CONCERNS.md)

**Validation:**
- Zod schemas for configuration validation (`src/config/index.ts`)
- Runtime type checking at API boundaries
- Certificate verification before processing

**Authentication:**
- BRC-103/104 mutual authentication middleware
- JWT session tracking (`src/auth/`)
- Certificate-based identity verification

**Encryption:**
- Per-interaction encryption with Perfect Forward Secrecy
- BRC-42 key derivation for counterparty encryption
- AES-256-GCM for at-rest encryption

---

*Architecture analysis: 2026-02-15*
*Update when major patterns change*
