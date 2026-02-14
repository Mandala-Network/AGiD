# Coding Conventions

**Analysis Date:** 2026-02-14

## Naming Patterns

**Files:**
- kebab-case for all files: `agent-wallet.ts`, `session-manager.ts`, `per-interaction.ts`
- *.test.ts for test files in `__tests__/`
- index.ts for barrel exports

**Functions:**
- camelCase for all functions: `createSession()`, `verifySignature()`, `uploadDocument()`
- Factory functions: `create*()` prefix: `createAGIdentity()`, `createAgentWallet()`
- Handlers: `handle*` prefix where applicable

**Variables:**
- camelCase for variables: `sessionId`, `userPublicKey`, `vaultIndex`
- UPPER_SNAKE_CASE for constants: Not commonly used (prefer const objects)
- No underscore prefix for private members (use `private` keyword)

**Types:**
- PascalCase for interfaces: `BRC100Wallet`, `SessionManagerConfig`, `VaultIndex`
- PascalCase for type aliases: `TeamRole`, `SecurityLevel`, `ShadStrategy`
- No I prefix for interfaces: `BRC100Wallet` not `IBRC100Wallet`
- Suffix patterns: `*Config`, `*Result`, `*Entry`, `*Options`

## Code Style

**Formatting:**
- Prettier 3.4.0 with default config
- 2 space indentation
- Single quotes for strings
- Semicolons required
- ~100 character line length

**Linting:**
- ESLint 9.0.0
- TypeScript strict mode enabled
- Run: `npm run lint`

**TypeScript:**
- Strict mode with `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`
- ES2022 target, NodeNext module system
- Declaration maps enabled for debugging

## Import Organization

**Order:**
1. External packages (vitest, express, @bsv/*)
2. Internal modules (relative imports)
3. Type imports (import type {})

**Grouping:**
- No explicit blank lines between groups (Prettier handles)
- ESM imports with .js extensions for compiled output

**Path Aliases:**
- None configured (relative imports used)

## Error Handling

**Patterns:**
- Throw errors, catch at boundaries (HTTP handlers, main functions)
- Descriptive error messages with context
- Async functions use try/catch, no .catch() chains

**Error Types:**
- Standard Error class (no custom error classes observed)
- Include operation context in message
- Log before throwing where appropriate

## Logging

**Framework:**
- Console.log/console.error (no structured logging library)
- Configurable via AGID_SERVER_LOG_LEVEL

**Patterns:**
- Log at service boundaries
- Include context: `logger.info(\`Agent identity: ${publicKey.slice(0, 16)}...\`)`
- No console.log in production-critical paths (use configurable logging)

## Comments

**When to Comment:**
- Explain why, not what
- Document business logic, security implications
- Algorithm explanations for complex operations

**JSDoc/TSDoc:**
- Required for all public APIs and factory functions
- Use @param, @returns, @example tags
- Module-level comments with purpose description

**Section Separators:**
```typescript
// =========================================================================
// Private Helper Methods
// =========================================================================
```

**TODO Comments:**
- Format: `// TODO: description`
- Not linked to issues (no consistent pattern)

## Function Design

**Size:**
- Keep functions focused (no explicit line limit)
- Extract helpers for complex logic

**Parameters:**
- Use config objects for 3+ parameters: `function create(config: CreateConfig)`
- Destructure in implementation where helpful

**Return Values:**
- Explicit return statements
- Return early for guard clauses
- Async functions return Promise<T>

## Module Design

**Exports:**
- Named exports preferred
- Barrel exports via index.ts
- Main entry re-exports all public APIs

**Barrel Files:**
- index.ts in each module directory
- Export public API only
- `export * from './component.js'` pattern

**Example:**
```typescript
// src/auth/index.ts
export { SessionManager } from './session-manager.js';
export type { SessionManagerConfig, AuthSession } from './session-manager.js';
```

## Async/Await

**Patterns:**
- All async operations use async/await
- No raw Promise chains (.then/.catch)
- Proper error handling with try/catch

## Configuration

**Pattern:**
- Config interfaces per module: `SessionManagerConfig`, `VaultConfig`
- Factory functions accept config with sensible defaults
- Nullish coalescing for defaults: `config.timeout ?? 30000`

## Class Structure

**Private State:**
- Use `private` keyword for encapsulation
- Map-based storage for collections
- Cleanup in lifecycle methods (stop(), destroy())

**Organization:**
```typescript
class MyClass {
  // Private fields
  private config: Config;
  private state: Map<string, Value>;

  // Constructor
  constructor(config: Config) { ... }

  // Public methods
  async publicMethod(): Promise<Result> { ... }

  // =========================================================================
  // Private Helper Methods
  // =========================================================================

  private helperMethod(): void { ... }
}
```

---

*Convention analysis: 2026-02-14*
*Update when patterns change*
