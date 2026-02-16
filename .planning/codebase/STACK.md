# Technology Stack

**Analysis Date:** 2026-02-15

## Languages

**Primary:**
- TypeScript 5.7 - All application code (`package.json`, `tsconfig.json`)

**Secondary:**
- JavaScript - Configuration files
- Python 3 - Shad (AI research daemon) integration (`src/shad/shad-integration.ts`)

## Runtime

**Environment:**
- Node.js >= 22.0.0 (`package.json` engines field)
- ES2022 target with NodeNext module resolution (`tsconfig.json`)

**Package Manager:**
- npm - Package manager
- Lockfile: `package-lock.json` present

## Frameworks

**Core:**
- Express 5.0 - HTTP server framework (`src/server/auth-server.ts`)
- Commander 12.0 - CLI framework (`src/cli/index.ts`)

**Testing:**
- Vitest 3.0 - Test runner and assertions (`vitest.config.ts`)
- Node.js built-in test utilities

**Build/Dev:**
- TypeScript 5.7 - Compilation to JavaScript
- ESLint 9.0 - Linting (`npm run lint`)
- Prettier 3.4 - Code formatting (`npm run format`)

## Key Dependencies

**Critical:**
- @bsv/sdk 2.0.3 - BSV blockchain SDK for transactions and cryptography
- @bsv/wallet-toolbox 2.0.14 - BRC-100 wallet implementation
- @bsv/wallet-toolbox-mpc - MPC threshold signature wallet (local dev)
- @bsv/auth-express-middleware 2.0.2 - BRC-103/104 mutual authentication
- @bsv/message-box-client 2.0.0 - P2P encrypted messaging protocol

**Infrastructure:**
- express 5.0 - HTTP routing and API server
- ws 8.18.1 - WebSocket support for OpenClaw gateway
- jsonwebtoken 9.0.3 - JWT session handling (`src/auth/`)
- zod 3.23.0 - Runtime schema validation
- dotenv 17.3.1 - Environment variable loading

**Cryptography:**
- curvepoint (github:p2ppsr/curvepoint) - Elliptic curve operations

## Configuration

**Environment:**
- .env files - Environment-based configuration (`.env.example` template)
- Centralized config: `src/config/index.ts` - Typed config loader with validation
- Key vars: `AGENT_PRIVATE_KEY`, `AGID_NETWORK`, `OPENCLAW_GATEWAY_URL`, `UHRP_STORAGE_URL`, `MESSAGEBOX_HOST`, `TRUSTED_CERTIFIERS`

**Build:**
- `tsconfig.json` - TypeScript compiler options (strict mode, NodeNext modules)
- `vitest.config.ts` - Test runner configuration
- ESLint and Prettier configs (inline in package.json or default settings)

## Platform Requirements

**Development:**
- macOS/Linux/Windows - Any platform with Node.js >= 22
- Optional: Python 3 for Shad integration
- Optional: Obsidian vault for local encrypted storage

**Production:**
- Node.js server runtime
- Environment variables for configuration
- Optional MPC cosigner endpoints for distributed signing
- BSV blockchain network access (mainnet or testnet)

---

*Stack analysis: 2026-02-15*
*Update after major dependency changes*
