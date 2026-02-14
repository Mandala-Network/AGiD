# Testing Patterns

**Analysis Date:** 2026-02-14

## Test Framework

**Runner:**
- Vitest 3.0.0
- Config: `vitest.config.ts` in project root

**Assertion Library:**
- Vitest built-in expect
- Matchers: toBe, toEqual, toThrow, toMatchObject, toBeDefined

**Run Commands:**
```bash
npm test                              # Run all tests
npm run test:watch                    # Watch mode (vitest)
npm test -- path/to/file.test.ts     # Single file
# Coverage not configured as npm script
```

## Test File Organization

**Location:**
- `src/__tests__/` directory (co-located with source)
- Not alongside individual source files

**Naming:**
- `*.test.ts` suffix for all test files
- Descriptive names: `session-security.test.ts`, `team-vault.test.ts`

**Structure:**
```
src/
├── __tests__/
│   ├── test-utils.ts                    # Shared utilities
│   ├── audit-trail.test.ts              # 25 tests
│   ├── certificate-identity.test.ts     # 29 tests
│   ├── client-sdk.test.ts               # 25 tests
│   ├── cryptographic-security.test.ts   # 22 tests
│   ├── enterprise-compliance.test.ts    # 18 tests
│   ├── per-interaction-encryption.test.ts # 26 tests
│   ├── session-security.test.ts         # 28 tests
│   ├── team-vault.test.ts               # 44 tests
│   └── vault-isolation.test.ts          # 18 tests
├── wallet/
│   └── agent-wallet.ts
└── ...
```

## Test Structure

**Suite Organization:**
```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SessionManager } from '../auth/session-manager.js';
import { MockSecureWallet, sleep } from './test-utils.js';

describe('Session Security', () => {
  let wallet: MockSecureWallet;
  let sessionManager: SessionManager;

  beforeEach(() => {
    wallet = new MockSecureWallet();
    sessionManager = new SessionManager({
      wallet,
      maxSessionDurationMs: 1000,
      timingAnomalyThresholdMs: 100,
      cleanupIntervalMs: 500
    });
  });

  afterEach(() => {
    sessionManager.stop();
  });

  describe('Session Creation', () => {
    it('should create sessions with unique IDs', async () => {
      const session1 = await sessionManager.createSession('user-1');
      const session2 = await sessionManager.createSession('user-2');

      expect(session1.sessionId).toBeDefined();
      expect(session1.sessionId).not.toBe(session2.sessionId);
    });
  });
});
```

**Patterns:**
- Nested describe blocks for feature grouping
- beforeEach for per-test setup
- afterEach for cleanup (stop timers, clear state)
- Arrange-Act-Assert pattern in test bodies
- One assertion focus per test (multiple expects OK)

## Mocking

**Framework:**
- Vitest built-in mocking (vi)
- Module mocking via vi.mock() at top of file

**Patterns:**
```typescript
import { vi } from 'vitest';

// Spy on methods
const spy = vi.spyOn(wallet, 'encrypt');
expect(spy).toHaveBeenCalledWith(expectedArgs);

// Mock return values
vi.mocked(wallet.getPublicKey).mockResolvedValue({ publicKey: '...' });

// Fake timers for timing tests
vi.useFakeTimers();
vi.advanceTimersByTime(1000);
vi.useRealTimers();
```

**What to Mock:**
- External service calls (MessageBox, UHRP)
- File system operations
- Time/dates (vi.useFakeTimers)
- Random values for deterministic tests

**What NOT to Mock:**
- Cryptographic operations (use real crypto in tests)
- Internal pure functions
- The MockSecureWallet uses real Web Crypto API

## Fixtures and Factories

**Test Data:**
```typescript
// src/__tests__/test-utils.ts

export class MockSecureWallet implements BRC100Wallet {
  // Full implementation with real crypto
  async getPublicKey(): Promise<{ publicKey: string }> { ... }
  async encrypt(args: EncryptArgs): Promise<EncryptResult> { ... }
  async decrypt(args: DecryptArgs): Promise<DecryptResult> { ... }
  // ... all BRC100Wallet methods
}

export function createDeterministicWallet(seed: string): MockSecureWallet {
  // Reproducible wallet from seed
}

export function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

**Location:**
- `src/__tests__/test-utils.ts` for shared utilities
- Factory functions defined in test file when simple

## Coverage

**Requirements:**
- No enforced coverage target
- 235 tests across 9 categories

**Configuration:**
```typescript
// vitest.config.ts
coverage: {
  provider: 'v8',
  reporter: ['text', 'html', 'lcov'],
}
```

**View Coverage:**
```bash
npx vitest run --coverage
open coverage/index.html
```

## Test Types

**Unit Tests:**
- Test single class/function in isolation
- Mock external dependencies
- Fast: each test <100ms
- Examples: SessionManager methods, encryption operations

**Security Tests:**
- Timing anomaly detection (Edwin-style)
- Replay attack prevention
- Signature verification
- Encryption/decryption roundtrips
- Access control enforcement
- Examples: `session-security.test.ts`, `cryptographic-security.test.ts`

**Integration Tests:**
- Multi-component interactions
- End-to-end workflows within test boundaries
- Examples: `team-vault.test.ts` (vault + encryption + roles)

**E2E Tests:**
- Not currently implemented
- Server endpoints tested indirectly via unit tests

## Common Patterns

**Async Testing:**
```typescript
it('should handle async operation', async () => {
  const result = await asyncFunction();
  expect(result).toBe('expected');
});
```

**Error Testing:**
```typescript
it('should throw on invalid input', () => {
  expect(() => functionCall()).toThrow('error message');
});

// Async error
it('should reject on failure', async () => {
  await expect(asyncCall()).rejects.toThrow('error message');
});
```

**Timing Tests:**
```typescript
it('should detect timing anomalies', async () => {
  const session = await sessionManager.createSession('user');

  await sleep(200); // Exceed threshold

  const result = await sessionManager.verifySession(session.sessionId);
  expect(result.timingAnomaly).toBe(true);
});
```

**Cryptographic Roundtrip:**
```typescript
it('should encrypt and decrypt successfully', async () => {
  const plaintext = 'secret message';

  const encrypted = await encryption.encrypt({
    plaintext: new TextEncoder().encode(plaintext),
    counterparty: recipientKey
  });

  const decrypted = await encryption.decrypt({
    ciphertext: encrypted.ciphertext,
    keyId: encrypted.keyId
  });

  expect(new TextDecoder().decode(decrypted.plaintext)).toBe(plaintext);
});
```

**Snapshot Testing:**
- Not used in this codebase
- Prefer explicit assertions for clarity

## Test Categories Summary

| Test File | Tests | Coverage Area |
|-----------|-------|--------------|
| `client-sdk.test.ts` | 25 | HTTP client, auth, batching |
| `per-interaction-encryption.test.ts` | 26 | PFS, unique keys, envelopes |
| `cryptographic-security.test.ts` | 22 | Key derivation, signatures |
| `certificate-identity.test.ts` | 29 | Certificates, verification, revocation |
| `team-vault.test.ts` | 44 | Group encryption, RBAC |
| `vault-isolation.test.ts` | 18 | Per-user encryption, isolation |
| `enterprise-compliance.test.ts` | 18 | Attack vectors, performance |
| `audit-trail.test.ts` | 25 | Hash chains, tamper detection |
| `session-security.test.ts` | 28 | Timing anomaly, expiration, replay |

**Total: 235 tests**

---

*Testing analysis: 2026-02-14*
*Update when test patterns change*
