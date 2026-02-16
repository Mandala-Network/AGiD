# Codebase Structure

**Analysis Date:** 2026-02-15

## Directory Layout

```
agidentity/
├── src/                    # TypeScript source code
│   ├── __tests__/          # Centralized integration tests
│   ├── audit/              # Signed audit trails
│   ├── auth/               # Session management
│   ├── cli/                # Command-line interface
│   ├── client/             # HTTP client SDK
│   ├── config/             # Configuration loading
│   ├── encryption/         # Encryption strategies
│   ├── gateway/            # OpenClaw gateway integration
│   ├── identity/           # Certificate & identity verification
│   ├── memory/             # Agent memory system
│   ├── messaging/          # MessageBox & conversations
│   ├── openclaw/           # OpenClaw WebSocket client
│   ├── payment/            # Payment handling (placeholder)
│   ├── server/             # HTTP API server
│   ├── service/            # Unified service facade
│   ├── shad/               # Shad semantic memory integration
│   ├── team/               # Team vault & operations
│   ├── tools/              # Self-awareness tools for agents
│   ├── types/              # Core type definitions
│   ├── uhrp/               # Blockchain storage manager
│   ├── vault/              # Local encrypted vault
│   ├── wallet/             # Agent wallet implementations
│   ├── index.ts            # Main module export
│   └── start.ts            # Gateway startup script
├── dist/                   # Compiled JavaScript (gitignored)
├── node_modules/           # Dependencies (gitignored)
├── .planning/              # Project planning documents
│   └── codebase/           # Codebase analysis documents
├── package.json            # Project manifest
├── package-lock.json       # Dependency lock file
├── tsconfig.json           # TypeScript configuration
├── vitest.config.ts        # Test runner configuration
├── .env.example            # Environment template
├── .gitignore              # Git exclusions
└── README.md               # User documentation
```

## Directory Purposes

**src/__tests__/**
- Purpose: Centralized integration and security tests
- Contains: Test files for multi-component integration scenarios
- Key files: `certificate-identity.test.ts`, `vault-isolation.test.ts`, `enterprise-compliance.test.ts`, `test-utils.ts`
- Subdirectories: None (flat structure)

**src/audit/**
- Purpose: Immutable audit trail with cryptographic signatures
- Contains: `signed-audit.ts` - SignedAuditTrail implementation
- Key files: `signed-audit.ts`
- Subdirectories: None

**src/auth/**
- Purpose: Session management and authentication helpers
- Contains: SessionManager implementation
- Key files: Session tracking utilities
- Subdirectories: None

**src/cli/**
- Purpose: Command-line interface for agent operations
- Contains: CLI commands, REPL chat interface
- Key files: `index.ts` (entry point), `commands/info.ts`, `commands/chat.ts`, `repl/`
- Subdirectories: `commands/`, `repl/`

**src/client/**
- Purpose: HTTP client SDK for AGIdentity API
- Contains: `agidentity-client.ts` - Authenticated HTTP client
- Key files: `agidentity-client.ts`
- Subdirectories: None

**src/config/**
- Purpose: Centralized configuration loading and validation
- Contains: Environment variable parsing, config types
- Key files: `index.ts` - loadConfig(), getConfig(), validateConfig()
- Subdirectories: None

**src/encryption/**
- Purpose: Encryption strategies (per-interaction, session-based)
- Contains: `per-interaction.ts`, `session-encryption.ts`
- Key files: PerInteractionEncryption, SessionEncryption implementations
- Subdirectories: None

**src/gateway/**
- Purpose: OpenClaw AI gateway integration layer
- Contains: `agidentity-openclaw-gateway.ts` - Full integration chain
- Key files: `agidentity-openclaw-gateway.ts`, `agidentity-openclaw-gateway.test.ts`
- Subdirectories: None

**src/identity/**
- Purpose: Certificate verification and identity gating
- Contains: IdentityGate, CertificateAuthority, CertificateVerifier
- Key files: `identity-gate.ts`, `certificate-authority.ts`, `certificate-verifier.ts`
- Subdirectories: None

**src/memory/**
- Purpose: AI agent long-term memory with MCP server
- Contains: AGIdentityMemoryServer, MemoryWriter, MemoryReader, MemoryGarbageCollector
- Key files: `agidentity-memory-server.ts`, `memory-writer.ts`, `memory-reader.ts`, `memory-gc.ts`
- Subdirectories: None

**src/messaging/**
- Purpose: P2P messaging and conversation management
- Contains: MessageBoxGateway, AGIDMessageClient, GatedMessageHandler, ConversationManager
- Key files: `messagebox-gateway.ts`, `message-client.ts`, `gated-message-handler.ts`
- Subdirectories: None

**src/openclaw/**
- Purpose: OpenClaw WebSocket client
- Contains: `openclaw-client.ts` - WebSocket client with reconnection
- Key files: `openclaw-client.ts`, `openclaw-client.test.ts`
- Subdirectories: None

**src/server/**
- Purpose: HTTP API server with BRC-103/104 auth
- Contains: `auth-server.ts` - Express server with auth middleware
- Key files: `auth-server.ts` (898 lines - identified in CONCERNS.md as large)
- Subdirectories: None

**src/service/**
- Purpose: Unified service facade composing all components
- Contains: `agidentity-service.ts` - Main service factory
- Key files: `agidentity-service.ts`
- Subdirectories: None

**src/shad/**
- Purpose: Shad (Shannon's Daemon) AI research integration
- Contains: ShadIntegration, ShadTempVaultExecutor, EncryptedShadVault
- Key files: `shad-integration.ts`, `shad-temp-executor.ts`, `encrypted-vault.ts`
- Subdirectories: None

**src/team/**
- Purpose: Team vault and secure team operations
- Contains: SecureTeamVault, TeamVault implementations
- Key files: `secure-team-vault.ts` (930 lines), `team-vault.ts` (840 lines)
- Subdirectories: None

**src/tools/**
- Purpose: Self-awareness tools for AI agents
- Contains: Identity tools for agent introspection
- Key files: `identity-tools.ts`
- Subdirectories: None

**src/types/**
- Purpose: Core TypeScript type definitions
- Contains: BRC standard interfaces, wallet types, certificate types, message types
- Key files: `index.ts` (630 lines - all types), `openclaw-gateway.ts`
- Subdirectories: None

**src/uhrp/**
- Purpose: Blockchain storage manager (UHRP protocol)
- Contains: `storage-manager.ts` - AGIdentityStorageManager
- Key files: `storage-manager.ts`
- Subdirectories: None

**src/vault/**
- Purpose: Local encrypted vault (Obsidian integration)
- Contains: `local-encrypted-vault.ts`, `index.ts`
- Key files: `local-encrypted-vault.ts`
- Subdirectories: None

**src/wallet/**
- Purpose: Agent wallet implementations (local and MPC)
- Contains: AgentWallet, MPCAgentWallet, MPC integration
- Key files: `agent-wallet.ts`, `mpc-agent-wallet.ts` (593 lines), `mpc-integration.ts`
- Subdirectories: None

## Key File Locations

**Entry Points:**
- `src/index.ts` - Main module export, createAGIdentity() factory
- `src/start.ts` - Gateway startup script (npm run gateway)
- `src/cli/index.ts` - CLI entry point (bin/agid)
- `src/server/auth-server.ts` - HTTP API server

**Configuration:**
- `tsconfig.json` - TypeScript compiler options (strict mode, ES2022, NodeNext)
- `vitest.config.ts` - Test runner configuration
- `package.json` - Project metadata, scripts, dependencies
- `.env.example` - Environment variable template

**Core Logic:**
- `src/service/agidentity-service.ts` - Unified service composition
- `src/gateway/agidentity-openclaw-gateway.ts` - Full integration pipeline
- `src/identity/identity-gate.ts` - Certificate verification gating
- `src/wallet/agent-wallet.ts` - BRC-100 wallet implementation
- `src/vault/local-encrypted-vault.ts` - Local storage abstraction

**Testing:**
- `src/__tests__/test-utils.ts` - Shared test utilities and mocks
- `src/__tests__/` - Integration and security tests
- `src/**/*.test.ts` - Co-located unit tests

**Documentation:**
- `README.md` - User-facing installation and usage guide
- `.planning/codebase/` - Technical codebase analysis documents

## Naming Conventions

**Files:**
- kebab-case.ts: All TypeScript source files
- *.test.ts: Test files (co-located or in __tests__/)
- index.ts: Barrel exports for public API

**Directories:**
- kebab-case: All directories
- Singular names for features (wallet, vault, identity)
- Plural for collections (__tests__, tools)

**Special Patterns:**
- index.ts: Public API exports for each module
- *.test.ts: Test files alongside or in __tests__/
- start.ts: Executable entry point for services

## Where to Add New Code

**New Feature:**
- Primary code: `src/<feature-name>/index.ts`
- Tests: `src/<feature-name>/*.test.ts` or `src/__tests__/<feature-name>.test.ts`
- Types: Add to `src/types/index.ts` or create `src/types/<feature>.ts`

**New Wallet Implementation:**
- Implementation: `src/wallet/<name>-wallet.ts`
- Interface: Implement `BRC100Wallet` from `src/types/index.ts`
- Tests: `src/wallet/<name>-wallet.test.ts`

**New Storage Backend:**
- Implementation: `src/vault/<name>-vault.ts`
- Interface: Implement vault interface
- Tests: `src/__tests__/vault-<name>.test.ts`

**New CLI Command:**
- Definition: `src/cli/commands/<command>.ts`
- Registration: Add to `src/cli/index.ts`
- Tests: `src/cli/commands/<command>.test.ts`

**New API Endpoint:**
- Handler: Add to `src/server/auth-server.ts` (consider refactoring to separate route files)
- Types: Add to `src/types/index.ts`
- Tests: `src/__tests__/` or co-located test

**Utilities:**
- Shared helpers: Create `src/utils/<category>.ts` if needed (currently no utils/ directory)
- Type definitions: `src/types/index.ts`

## Special Directories

**dist/**
- Purpose: Compiled JavaScript output
- Source: Auto-generated by `tsc` build
- Committed: No (in .gitignore)

**node_modules/**
- Purpose: Installed dependencies
- Source: npm install
- Committed: No (in .gitignore)

**.planning/codebase/**
- Purpose: Technical codebase analysis documents
- Source: Generated by /gsd:map-codebase
- Committed: Yes (documentation)

**data/** (untracked - see CONCERNS.md)
- Purpose: Runtime data (SQLite databases)
- Source: Created at runtime
- Committed: No (should be in .gitignore)

**logs/** (untracked - see CONCERNS.md)
- Purpose: Application logs
- Source: Created at runtime
- Committed: No (should be in .gitignore)

---

*Structure analysis: 2026-02-15*
*Update when directory structure changes*
