# Architecture

**Analysis Date:** 2026-02-14

## Pattern Overview

**Overall:** Layered/Modular Service Architecture with Plugin System

**Key Characteristics:**
- Plugin-based design for OpenClaw integration
- BSV blockchain-backed identity and storage
- Multi-layer encryption (per-interaction, team, vault)
- Service-oriented with clean module boundaries
- Factory pattern for component initialization

## Layers

**Entry & Factory Layer:**
- Purpose: Unified initialization and component orchestration
- Contains: `createAGIdentity()`, `createAGIdentityWithOpenClaw()` factory functions
- Location: `src/index.ts`
- Depends on: All component layers
- Used by: External consumers, OpenClaw gateway

**Core Component Layer:**
- Purpose: Primary features (wallet, storage, vault, messaging)
- Contains: AgentWallet, StorageManager, EncryptedVault, MessageClient
- Location: `src/wallet/`, `src/uhrp/`, `src/vault/`, `src/shad/`, `src/messaging/`
- Depends on: Configuration, Types
- Used by: Service layer, Plugin layer

**Encryption & Security Layer:**
- Purpose: Cryptographic operations and access control
- Contains: SessionEncryption, IdentityGate, CertificateAuthority, SignedAuditTrail
- Location: `src/encryption/`, `src/identity/`, `src/audit/`
- Depends on: Wallet (BRC100Wallet interface)
- Used by: All components requiring encryption/auth

**Team Collaboration Layer:**
- Purpose: Group encryption and role-based access
- Contains: TeamVault, SecureTeamVault (CurvePoint integration)
- Location: `src/team/`
- Depends on: Wallet, Encryption
- Used by: Multi-user document access

**API & Server Layer:**
- Purpose: HTTP endpoints with mutual authentication
- Contains: Express app, auth middleware, session management
- Location: `src/server/`, `src/auth/`, `src/client/`
- Depends on: Identity, Wallet, Vault components
- Used by: External HTTP clients

**Plugin & Integration Layer:**
- Purpose: OpenClaw tool registration and context management
- Contains: AGIdentityPlugin, SecurePlugin
- Location: `src/plugin/`
- Depends on: All core components
- Used by: OpenClaw gateway

## Data Flow

**HTTP Request Lifecycle:**

1. Request arrives at Express server (`src/server/auth-server.ts`)
2. Auth middleware validates BRC-103/104 mutual auth signature
3. IdentityGate verifies certificates if required (`src/identity/identity-gate.ts`)
4. SessionManager tracks session context (`src/auth/session-manager.ts`)
5. Tool execution with per-interaction encryption (`src/encryption/per-interaction.ts`)
6. Operation dispatched to appropriate component (vault, storage, team)
7. Audit trail entry created (signed, blockchain-anchored)
8. Response returned with auth signature

**Per-Message Encryption Flow:**
1. Derive unique key from session + message index + timestamp (BRC-42/43)
2. Encrypt plaintext with user's counterparty key
3. Include keyId and metadata in envelope
4. On decrypt: verify signature, check timing anomalies

**Vault Sync Flow:**
1. Walk local file system or Obsidian vault
2. Encrypt each document with derived key (AES-256-GCM)
3. Upload to UHRP (gets immutable hash)
4. Create blockchain timestamp transaction
5. Store vault index (encrypted) back to UHRP
6. Maintain local cache for fast Shad access

**State Management:**
- File-based: Vault documents in local filesystem
- SQLite: Wallet keys and UTXO tracking
- In-memory: Session state, document cache
- Blockchain: Timestamps, revocation outpoints

## Key Abstractions

**BRC100Wallet Interface:**
- Purpose: Unified interface for all cryptographic operations
- Examples: `AgentWallet` wrapping @bsv/wallet-toolbox (`src/wallet/agent-wallet.ts`)
- Pattern: Interface with full crypto suite (encrypt, decrypt, sign, verify, HMAC)

**Storage Manager:**
- Purpose: UHRP protocol integration for cloud storage
- Examples: `AGIdentityStorageManager` (`src/uhrp/storage-manager.ts`)
- Pattern: Upload/download with encryption and blockchain timestamps

**Encrypted Vault:**
- Purpose: Document management with encryption
- Examples: `LocalEncryptedVault` (fast cache), `EncryptedShadVault` (UHRP-backed)
- Pattern: Per-document encryption with BRC-42 derived keys

**Identity Gate:**
- Purpose: Central access control and verification
- Examples: `IdentityGate`, `CertificateAuthority`, `CertificateVerifier` (`src/identity/`)
- Pattern: Certificate-based with blockchain revocation

**Session Encryption:**
- Purpose: Perfect Forward Secrecy per interaction
- Examples: `SessionEncryption`, `PerInteractionEncryption` (`src/encryption/per-interaction.ts`)
- Pattern: Unique keyId per message (Edwin-style security)

## Entry Points

**Library Entry:**
- Location: `src/index.ts`
- Triggers: `import { createAGIdentity } from 'agidentity'`
- Responsibilities: Export all public APIs, factory functions

**Plugin Entry:**
- Location: `src/plugin/agidentity-plugin.ts`
- Triggers: OpenClaw gateway plugin registration
- Responsibilities: Tool registration, context management

**Service Entry:**
- Location: `src/service/agidentity-service.ts`
- Triggers: `createAGIdentityService()` factory
- Responsibilities: Initialize all components, return unified service

**Server Entry:**
- Location: `src/server/auth-server.ts`
- Triggers: `createAGIDServer()` factory
- Responsibilities: Express app with BRC-103/104 authentication

**Client Entry:**
- Location: `src/client/agidentity-client.ts`
- Triggers: `createAGIDClient()` factory
- Responsibilities: Authenticated HTTP requests to AGIdentity servers

## Error Handling

**Strategy:** Throw exceptions, catch at boundaries, log with context

**Patterns:**
- Services throw Error with descriptive messages
- HTTP endpoints catch, return structured error responses
- Validation errors fail fast before operations
- Audit trail records operation failures

## Cross-Cutting Concerns

**Logging:**
- Console.log/console.error for output
- Configurable via AGID_SERVER_LOG_LEVEL
- Context included where relevant

**Validation:**
- Zod schemas available (underutilized)
- Manual validation in handlers
- Certificate verification via IdentityGate

**Authentication:**
- BRC-103/104 mutual auth on all HTTP endpoints
- Certificate verification optional but recommended
- Session tracking with timing anomaly detection

**Encryption:**
- Per-document: BRC-42 key derivation
- Per-interaction: Unique keyId (PFS)
- Team: CurvePoint group encryption

---

*Architecture analysis: 2026-02-14*
*Update when major patterns change*
