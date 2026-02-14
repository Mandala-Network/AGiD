# Technology Stack

**Analysis Date:** 2026-02-14

## Languages

**Primary:**
- TypeScript 5.7 - All application code (`package.json`, `tsconfig.json`)

**Secondary:**
- JavaScript - Build output (`dist/`)
- Python 3 - Optional Shad RLM integration (`src/shad/shad-integration.ts`)

## Runtime

**Environment:**
- Node.js >= 22.0.0 (`package.json` engines field)
- ES Modules (type: "module" in `package.json`)
- Target: ES2022 (`tsconfig.json`)

**Package Manager:**
- npm 10.x
- Lockfile: `package-lock.json` present

## Frameworks

**Core:**
- Express 5.0.0 - HTTP server with BRC-103/104 mutual auth (`src/server/auth-server.ts`)
- @bsv/auth-express-middleware 2.0.2 - Authentication middleware

**Testing:**
- Vitest 3.0.0 - Test runner with globals (`vitest.config.ts`)
- V8 coverage provider

**Build/Dev:**
- TypeScript 5.7 - Compilation to JavaScript
- ESLint 9.0.0 - Code linting
- Prettier 3.4.0 - Code formatting

## Key Dependencies

**Critical:**
- @bsv/sdk 2.0.3 - Cryptographic primitives (PrivateKey, signatures) (`src/wallet/agent-wallet.ts`)
- @bsv/wallet-toolbox 2.0.14 - BRC-100 wallet with SQLite storage (`src/wallet/agent-wallet.ts`)
- @bsv/message-box-client 2.0.0 - Async P2P encrypted messaging (`src/messaging/message-client.ts`)
- curvepoint (GitHub) - Group encryption for team collaboration (`src/team/team-vault.ts`)

**Infrastructure:**
- express 5.0.0 - HTTP routing (`src/server/auth-server.ts`)
- dotenv 17.3.1 - Environment configuration (`src/config/index.ts`)
- zod 3.23.0 - Schema validation (available, underutilized)

## Configuration

**Environment:**
- `.env` files via dotenv
- Key configs: AGENT_PRIVATE_KEY, AGID_NETWORK, UHRP_STORAGE_URL, MESSAGEBOX_HOST
- Reference: `.env.example` with comprehensive documentation

**Build:**
- `tsconfig.json` - TypeScript compiler (strict mode, ES2022 target)
- `vitest.config.ts` - Test configuration (30s timeout, V8 coverage)

## Platform Requirements

**Development:**
- macOS/Linux/Windows (any platform with Node.js 22+)
- Optional: Python 3 for Shad RLM integration
- SQLite for wallet storage (auto-created)

**Production:**
- Distributed as npm package
- Requires: UHRP storage provider, MessageBox service
- Optional: Shad installation for semantic memory

---

*Stack analysis: 2026-02-14*
*Update after major dependency changes*
