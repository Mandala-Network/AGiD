# Coding Conventions

**Analysis Date:** 2026-02-15

## Naming Patterns

**Files:**
- kebab-case for all TypeScript files (openclaw-client.ts, agent-wallet.ts, memory-writer.ts)
- *.test.ts for test files alongside source
- index.ts for barrel exports

**Functions:**
- camelCase for all functions
- Factory functions: create* prefix (createAgentWallet, createOpenClawClient, createAGIdentity)
- Getters: get* prefix (getPublicKey, getConfig, getSessionId)
- Checkers: is* prefix (isConnected, isAuthenticated)
- No special prefix for async functions

**Variables:**
- camelCase for variables
- UPPER_SNAKE_CASE for constants (limited use - mostly interface defaults)
- Private members: marked with `private` keyword (not underscore prefix)

**Types:**
- PascalCase for interfaces and type aliases (no I prefix)
- Interface names: descriptive without prefix (BRC100Wallet, not IBrc100Wallet)
- Config types: *Config suffix (OpenClawClientConfig, AGIdentityEnvConfig)
- Method parameter types: *Args suffix (GetPublicKeyArgs)
- Method result types: *Result suffix (GetPublicKeyResult)
- Type aliases: PascalCase (same as interfaces)

**Classes:**
- PascalCase for all class names
- Descriptive names without abbreviations where possible
- Examples: OpenClawClient, AgentWallet, MPCAgentWallet, EncryptedShadVault

## Code Style

**Formatting:**
- Tool: Prettier 3.4.0 (npm run format)
- Indentation: 2 spaces
- Line length: ~100-120 characters
- Quotes: Single quotes for strings
- Semicolons: Omitted (modern ES module style)
- Trailing commas: ES5-compatible

**Linting:**
- Tool: ESLint 9.0.0 (npm run lint)
- Runs on: src/ directory
- Configuration: Inline or flat config (no .eslintrc found)

**TypeScript:**
- Strict mode enabled (`tsconfig.json`)
- Target: ES2022
- Module: NodeNext (ES modules)
- All strict flags enabled: noUnusedLocals, noUnusedParameters, noImplicitReturns, noFallthroughCasesInSwitch

## Import Organization

**Order:**
1. External packages (ws, express, commander, etc.)
2. Internal modules from @bsv/* packages
3. Relative imports (., ..)
4. Type imports (import type {...})

**Grouping:**
- Blank lines between import groups
- No specific alphabetical sorting enforced
- Type imports separated when possible

**Path Aliases:**
- No path aliases configured
- All imports use relative paths (./file.js) or package names

**Module Extensions:**
- .js extensions in import statements (TypeScript ES module requirement)
- Example: `import { OpenClawClient } from './index.js'`

## Error Handling

**Patterns:**
- Throw errors with descriptive messages
- Catch at boundaries (route handlers, main functions, entry points)
- Async functions use try/catch, no .catch() chains
- Error messages include context

**Error Types:**
- Standard Error class for most cases
- Descriptive error messages
- Error cause chaining where appropriate: `new Error('Failed to X', { cause: originalError })`

**Logging:**
- Log errors with console.error before throwing (in some cases)
- No structured error handling framework

**Issue Identified:** Inconsistent error handling - some code uses `String(error)` which loses error details (see CONCERNS.md)

## Logging

**Framework:**
- Console.log/warn/error throughout codebase
- No structured logging library

**Patterns:**
- console.log for informational messages
- console.error for errors
- console.warn for warnings
- Logging at service boundaries and important state transitions

**Locations:**
- `src/start.ts` - Startup logging
- `src/gateway/agidentity-openclaw-gateway.ts` - Error and warning logging
- `src/vault/local-encrypted-vault.ts` - Debug logging

**Issue Identified:** No log levels, no way to suppress in production (see CONCERNS.md)

## Comments

**When to Comment:**
- JSDoc blocks for public APIs (classes, exported functions)
- Explain why, not what
- Document complex business logic
- Note security considerations
- Mark section dividers in large files

**JSDoc/TSDoc:**
- Required for public API classes and methods
- Includes @example blocks for complex APIs
- @param and @returns tags for method signatures
- Module-level documentation at top of files

**Example:**
```typescript
/**
 * OpenClaw Gateway WebSocket Client
 *
 * Provides secure communication with OpenClaw Gateway...
 *
 * @example
 * ```typescript
 * const client = await createOpenClawClient({...});
 * ```
 */
```

**Section Dividers:**
```typescript
// ==========================================================================
// Private Methods
// ==========================================================================
```

**TODO Comments:**
- Format: `// TODO: description`
- Example in `src/index.ts`: Future Memory Server exports documented

## Function Design

**Size:**
- Keep functions focused and reasonable length
- Large files identified in CONCERNS.md (>600 lines)
- Extract helpers for complex logic

**Parameters:**
- Config objects preferred for multiple parameters
- Destructuring in parameter list common
- Type safety via TypeScript interfaces

**Return Values:**
- Explicit return statements
- Return early for guard clauses
- Async functions return Promises
- Use typed return values

## Module Design

**Exports:**
- Named exports preferred
- Default exports rare (mainly for main module entry)
- Public API exported from index.ts barrel files
- Factory functions for complex object creation

**Barrel Files:**
- index.ts re-exports public API for each module
- Keeps internal helpers private
- Examples: `src/wallet/index.ts`, `src/openclaw/index.ts`

**Module Boundaries:**
- Vertical slice per feature (wallet, vault, identity)
- Clear separation of concerns
- Shared types in `src/types/`
- Cross-cutting concerns (config, encryption) as separate modules

## Type Safety

**TypeScript Usage:**
- Strict mode enabled
- Explicit types for function parameters and returns
- Interface definitions for all public APIs
- Type inference used for obvious cases

**Issue Identified:** 26+ instances of `as any` and `as unknown` type assertions bypass type safety (see CONCERNS.md for details)

**Recommendations:**
- Avoid type assertions where possible
- Use proper type definitions instead of `any`
- Document reasons for necessary type assertions

---

*Convention analysis: 2026-02-15*
*Update when patterns change*
