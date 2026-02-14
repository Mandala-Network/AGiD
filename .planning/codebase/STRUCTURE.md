# Codebase Structure

**Analysis Date:** 2026-02-14

## Directory Layout

```
agidentity/
├── src/                    # TypeScript source code
│   ├── index.ts           # Main entry point + factories
│   ├── audit/             # Signed audit trail
│   ├── auth/              # Session management
│   ├── client/            # HTTP client SDK
│   ├── config/            # Environment configuration
│   ├── encryption/        # Per-interaction encryption
│   ├── identity/          # Certificate authority & verification
│   ├── messaging/         # MessageBox P2P messaging
│   ├── payment/           # Payment logic (placeholder)
│   ├── plugin/            # OpenClaw plugin definitions
│   ├── server/            # Express HTTP server
│   ├── service/           # Unified service factory
│   ├── shad/              # Shad RLM integration
│   ├── team/              # Team vault & group encryption
│   ├── tools/             # Tool definitions (placeholder)
│   ├── types/             # TypeScript type definitions
│   ├── uhrp/              # UHRP storage manager
│   ├── vault/             # Local encrypted vault
│   ├── wallet/            # BRC-100 wallet
│   └── __tests__/         # Test files
├── dist/                   # Compiled JavaScript output
├── .planning/              # Planning documentation
├── package.json            # Project manifest
├── tsconfig.json           # TypeScript configuration
├── vitest.config.ts        # Test configuration
└── .env.example            # Environment variable reference
```

## Directory Purposes

**src/wallet/**
- Purpose: BRC-100 wallet wrapping @bsv/wallet-toolbox
- Contains: `agent-wallet.ts`, `index.ts`
- Key files: `agent-wallet.ts` - AgentWallet class implementing BRC100Wallet interface

**src/uhrp/**
- Purpose: Cloud encrypted document storage via UHRP protocol
- Contains: `storage-manager.ts`, `index.ts`
- Key files: `storage-manager.ts` - Upload/download with blockchain timestamps

**src/vault/**
- Purpose: Fast local encrypted cache for documents
- Contains: `local-encrypted-vault.ts`, `index.ts`
- Key files: `local-encrypted-vault.ts` - AES-256-GCM encryption with warmup

**src/shad/**
- Purpose: Shad RLM integration for semantic memory
- Contains: `encrypted-vault.ts`, `shad-integration.ts`, `index.ts`
- Key files: `shad-integration.ts` - Python subprocess bridge, `encrypted-vault.ts` - UHRP-backed vault

**src/encryption/**
- Purpose: Per-interaction Perfect Forward Secrecy
- Contains: `per-interaction.ts`, `index.ts`
- Key files: `per-interaction.ts` - SessionEncryption, PerInteractionEncryption classes

**src/identity/**
- Purpose: Certificate authority, verification, and access control
- Contains: `certificate-authority.ts`, `certificate-verifier.ts`, `identity-gate.ts`, `index.ts`
- Key files: `identity-gate.ts` - Central verification gate

**src/team/**
- Purpose: CurvePoint group encryption for team collaboration
- Contains: `team-vault.ts`, `secure-team-vault.ts`
- Key files: `team-vault.ts` - TeamVault with role-based access

**src/audit/**
- Purpose: Cryptographically signed audit entries
- Contains: `signed-audit.ts`, `index.ts`
- Key files: `signed-audit.ts` - SignedAuditTrail with hash chains

**src/auth/**
- Purpose: Session state tracking
- Contains: `session-manager.ts`, `index.ts`
- Key files: `session-manager.ts` - SessionManager with timing anomaly detection

**src/messaging/**
- Purpose: MessageBox async P2P messaging
- Contains: `message-client.ts`, `index.ts`
- Key files: `message-client.ts` - AGIDMessageClient wrapper

**src/server/**
- Purpose: Express HTTP server with BRC-103/104 auth
- Contains: `auth-server.ts`, `index.ts`
- Key files: `auth-server.ts` - createAGIDServer factory

**src/client/**
- Purpose: Authenticated HTTP client for AGIdentity servers
- Contains: `agidentity-client.ts`, `index.ts`
- Key files: `agidentity-client.ts` - AGIDClient class

**src/service/**
- Purpose: Unified service combining all components
- Contains: `agidentity-service.ts`, `index.ts`
- Key files: `agidentity-service.ts` - createAGIdentityService factory

**src/plugin/**
- Purpose: OpenClaw plugin definitions
- Contains: `agidentity-plugin.ts`, `secure-plugin.ts`, `index.ts`
- Key files: `agidentity-plugin.ts` - Tool registration for OpenClaw

**src/config/**
- Purpose: Environment variable loading with defaults
- Contains: `index.ts`
- Key files: `index.ts` - getConfig(), loadConfig()

**src/types/**
- Purpose: TypeScript interface definitions
- Contains: `index.ts`, `openclaw-plugin.ts`
- Key files: `index.ts` - BRC100Wallet, UHRPDocument, VaultIndex, TeamMember

**src/__tests__/**
- Purpose: Test files and utilities
- Contains: 9 test files + test-utils.ts
- Key files: `test-utils.ts` - MockSecureWallet, helper functions

## Key File Locations

**Entry Points:**
- `src/index.ts` - Library main entry, all exports
- `src/plugin/agidentity-plugin.ts` - OpenClaw plugin entry
- `src/service/agidentity-service.ts` - Unified service factory

**Configuration:**
- `tsconfig.json` - TypeScript compiler options
- `vitest.config.ts` - Test runner configuration
- `.env.example` - Environment variable documentation
- `src/config/index.ts` - Runtime config loading

**Core Logic:**
- `src/wallet/agent-wallet.ts` - BRC-100 wallet implementation
- `src/encryption/per-interaction.ts` - PFS encryption
- `src/identity/identity-gate.ts` - Access control
- `src/team/team-vault.ts` - Group encryption

**Testing:**
- `src/__tests__/*.test.ts` - 9 test files (235 tests)
- `src/__tests__/test-utils.ts` - MockSecureWallet, helpers

**Documentation:**
- `README.md` - User-facing documentation
- `GAP_ANALYSIS.md` - Production readiness gaps
- `.env.example` - Comprehensive config reference

## Naming Conventions

**Files:**
- kebab-case for all source files: `agent-wallet.ts`, `per-interaction.ts`
- index.ts for barrel exports in each directory
- *.test.ts for test files

**Directories:**
- lowercase single words: `wallet/`, `vault/`, `audit/`
- kebab-case for multi-word: not used (all single-word)
- `__tests__/` for test directory

**Special Patterns:**
- index.ts exports public API from each module
- Types in dedicated `types/` directory
- Test utilities in `__tests__/test-utils.ts`

## Where to Add New Code

**New Feature:**
- Primary code: `src/{feature}/` directory
- Types: `src/types/index.ts` or `src/{feature}/types.ts`
- Tests: `src/__tests__/{feature}.test.ts`

**New Component/Module:**
- Implementation: `src/{component}/{component-name}.ts`
- Barrel export: `src/{component}/index.ts`
- Types: Add to `src/types/index.ts`

**New API Endpoint:**
- Definition: `src/server/auth-server.ts` (add route)
- Handler: Inline or extract to `src/server/handlers/`
- Client method: `src/client/agidentity-client.ts`

**Utilities:**
- Shared helpers: `src/utils/` (create if needed)
- Type definitions: `src/types/index.ts`
- Test utilities: `src/__tests__/test-utils.ts`

## Special Directories

**dist/**
- Purpose: Compiled JavaScript output
- Source: Generated by `npm run build` (tsc)
- Committed: No (in .gitignore)

**.planning/**
- Purpose: Project planning documentation
- Source: GSD workflow outputs
- Committed: Yes

**node_modules/**
- Purpose: npm dependencies
- Source: npm install
- Committed: No (in .gitignore)

---

*Structure analysis: 2026-02-14*
*Update when directory structure changes*
