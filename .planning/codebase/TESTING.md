# Testing Patterns

**Analysis Date:** 2026-02-15

## Test Framework

**Runner:**
- Vitest 3.0.0
- Config: `vitest.config.ts` in project root

**Assertion Library:**
- Vitest built-in expect
- Matchers: toBe, toEqual, toThrow, toMatchObject, toHaveBeenCalled

**Run Commands:**
```bash
npm test                              # Run all tests
npm run test:watch                    # Watch mode (vitest)
vitest run                            # Direct vitest invocation
```

## Test File Organization

**Location:**
Two patterns observed:

1. **Co-located tests** (unit tests for specific modules):
   - `src/openclaw/openclaw-client.test.ts` - 23 tests
   - `src/wallet/mpc-integration.test.ts` - 20 tests
   - `src/shad/shad-temp-executor.test.ts` - 9 tests
   - `src/gateway/agidentity-openclaw-gateway.test.ts`

2. **Centralized tests** (integration/security tests):
   - `src/__tests__/agidentity-memory-server.test.ts`
   - `src/__tests__/certificate-identity.test.ts`
   - `src/__tests__/per-interaction-encryption.test.ts` - 26 tests
   - `src/__tests__/vault-isolation.test.ts`
   - `src/__tests__/team-vault.test.ts`
   - `src/__tests__/client-sdk.test.ts`
   - `src/__tests__/session-security.test.ts`
   - `src/__tests__/cryptographic-security.test.ts` - 22 tests
   - `src/__tests__/audit-trail.test.ts`
   - `src/__tests__/enterprise-compliance.test.ts` - 18 tests
   - `src/__tests__/test-utils.ts` - Shared test utilities

**Naming:**
- `*.test.ts` for all test files
- Descriptive names matching the module under test

**Structure:**
```
src/
  openclaw/
    openclaw-client.ts
    openclaw-client.test.ts
  wallet/
    agent-wallet.ts
    mpc-integration.test.ts
  __tests__/
    certificate-identity.test.ts
    vault-isolation.test.ts
    test-utils.ts
```

## Test Structure

**Suite Organization:**
```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('OpenClawClient', () => {
  let originalEnv: NodeJS.ProcessEnv

  beforeEach(() => {
    originalEnv = { ...process.env }
    vi.clearAllMocks()
  })

  afterEach(() => {
    process.env = originalEnv
  })

  describe('Constructor', () => {
    it('should construct with default config', () => {
      // test
    })
  })

  describe('Connection', () => {
    it('should connect and complete handshake', async () => {
      // test
    })
  })
})
```

**Patterns:**
- Nested describe blocks group tests by functionality
- beforeEach for per-test setup (clear mocks, reset state)
- afterEach to restore environment, clean up mocks
- Explicit arrange/act/assert structure in complex tests
- One assertion focus per test (but multiple expects allowed)

**Globals:**
- Vitest globals enabled (no need to import describe/it/expect)
- Configuration: `globals: true` in `vitest.config.ts`

## Mocking

**Framework:**
- Vitest built-in mocking (vi)
- Module mocking via vi.mock() at top of test file

**Mock WebSocket Pattern:**
```typescript
vi.mock('ws', () => {
  class MockWebSocket extends EventEmitter {
    static OPEN = 1
    static CLOSED = 3
    sentMessages: string[] = []

    simulateMessage(data: object) { }
    simulateHelloOk(sessionId: string) { }
  }
  return { default: MockWebSocket, WebSocket: MockWebSocket }
})
```

**Mock Usage in Tests:**
```typescript
const mockFn = vi.mocked(externalFunction)
mockFn.mockReturnValue('mocked result')
mockFn.mockResolvedValue({ data: 'test' })
expect(mockFn).toHaveBeenCalledWith('expected arg')
```

**What to Mock:**
- WebSocket connections (ws module)
- External API calls
- File system operations
- Environment variables (process.env)
- Child process execution
- Time/dates (vi.useFakeTimers if needed)

**What NOT to Mock:**
- Internal pure functions
- Type definitions
- Simple utilities
- Cryptographic operations (use real Web Crypto in tests via MockSecureWallet)

## Fixtures and Factories

**Test Data:**
```typescript
// Factory pattern in test-utils.ts
class MockSecureWallet implements BRC100Wallet {
  // Full implementation with real Web Crypto operations
}

class MockLocalEncryptedVault {
  // Local vault mock
}

class MockStorageProvider {
  // UHRP storage simulation
}

// Helper functions
function bytesToHex(bytes: Uint8Array): string { }
function randomBytes(length: number): Uint8Array { }
```

**Setup Helpers:**
```typescript
async function setupConnectedClient(): Promise<OpenClawClient> {
  const client = new OpenClawClient({ gatewayUrl: 'ws://test:123' })
  // ... setup steps
  return client
}
```

**Location:**
- `src/__tests__/test-utils.ts` - Shared mock implementations and helpers
- Factory functions in test files for simple cases
- Inline test data when appropriate

## Coverage

**Requirements:**
- No enforced coverage target
- Coverage tracked for awareness
- Focus on security-critical paths (cryptography, vault isolation, authentication)

**Configuration:**
- Provider: v8 (built-in with Vitest)
- Reporters: text, html, lcov
- Excludes: node_modules, dist, **/*.test.ts, test-utils.ts

**View Coverage:**
```bash
npm run test:coverage           # If configured
vitest run --coverage           # Direct vitest command
```

**Coverage Gaps Identified:**
- Only 15 test files for 64+ source files (~23% file coverage)
- Missing tests: `src/wallet/agent-wallet.ts`, `src/config/index.ts`, `src/cli/`, `src/audit/signed-audit.ts`, `src/uhrp/storage-manager.ts`
- See CONCERNS.md for full details

## Test Types

**Unit Tests:**
- Test single module in isolation
- Mock all external dependencies
- Fast execution (<100ms per test)
- Examples: `openclaw-client.test.ts`, `mpc-integration.test.ts`, `shad-temp-executor.test.ts`

**Integration Tests:**
- Test multiple modules together
- Mock only external boundaries (network, filesystem)
- Examples: `certificate-identity.test.ts`, `vault-isolation.test.ts`, `team-vault.test.ts`

**Security Tests:**
- Focused on cryptographic correctness and isolation
- Examples: `cryptographic-security.test.ts` (22 tests), `per-interaction-encryption.test.ts` (26 tests)
- Validate encryption, signatures, certificate verification

**Compliance Tests:**
- Enterprise audit and compliance requirements
- Example: `enterprise-compliance.test.ts` (18 tests)

**E2E Tests:**
- Not currently implemented

## Common Patterns

**Async Testing:**
```typescript
it('should handle async operation', async () => {
  const result = await asyncFunction()
  expect(result).toBe('expected')
})
```

**Error Testing:**
```typescript
it('should throw on invalid input', () => {
  expect(() => parse(null)).toThrow('Cannot parse null')
})

// Async error
it('should reject on failure', async () => {
  await expect(asyncCall()).rejects.toThrow('error message')
})
```

**WebSocket Testing:**
```typescript
it('should connect and complete handshake', async () => {
  const client = new OpenClawClient({ gatewayUrl: 'ws://test:123' })
  const connectPromise = client.connect()

  await new Promise(resolve => setTimeout(resolve, 10))
  const ws = getMockWebSocket(client)
  ws.simulateHelloOk('session-123')

  await connectPromise
  expect(client.isConnected()).toBe(true)
})
```

**Timeout/Timing:**
- Test timeout: 30 seconds (testTimeout: 30000 in config)
- Hook timeout: 10 seconds (hookTimeout: 10000)
- Short timeouts in tests: requestTimeout: 50 for fast failure

**Snapshot Testing:**
- Not used in this codebase
- Prefer explicit assertions

## Test Configuration

**vitest.config.ts:**
```typescript
{
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov']
    },
    testTimeout: 30000,
    hookTimeout: 10000
  }
}
```

**TypeScript:**
- Tests use same tsconfig.json as source
- Test files excluded from build output
- Type checking in tests enforced

---

*Testing analysis: 2026-02-15*
*Update when test patterns change*
