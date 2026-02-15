---
phase: 03-mpc-wallet-interface
plan: 01
subsystem: wallet
tags: [mpc, threshold-signatures, brc-100, dependency-injection]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: BRC100Wallet interface, AgentWallet reference implementation
provides:
  - MPCAgentWallet class implementing BRC100Wallet
  - IMPCWallet interface for external MPC implementation injection
  - MPCWalletFactory type for wallet creation
  - Signing lock pattern for MPC operation serialization
affects: [04-openclaw-integration, certificate-authority]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Dependency injection for external MPC implementation
    - Signing lock pattern for concurrent operation prevention
    - Interface-first design for external dependencies

key-files:
  created:
    - src/wallet/mpc-agent-wallet.ts
  modified:
    - src/wallet/index.ts
    - src/index.ts

key-decisions:
  - "Interface-only implementation - MPC modules are external"
  - "Dependency injection pattern for MPC wallet/factory"
  - "Signing lock prevents concurrent MPC operations corrupting WASM state"

patterns-established:
  - "External dependency injection via config object"
  - "Promise-based signing lock for serialization"

issues-created: []

# Metrics
duration: 4m 6s
completed: 2026-02-15
---

# Phase 3 Plan 01: MPC Agent Wallet Summary

**MPCAgentWallet class with dependency injection for external MPC threshold signature implementation**

## Performance

- **Duration:** 4m 6s
- **Started:** 2026-02-15T01:56:46Z
- **Completed:** 2026-02-15T02:00:52Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Created MPCAgentWallet implementing full BRC100Wallet interface
- Designed IMPCWallet interface mirroring wallet-toolbox-mpc for compatibility
- Implemented signing lock pattern preventing concurrent MPC operations
- Export factory function and types from package entry point

## Task Commits

Each task was committed atomically:

1. **Task 1: Create MPCAgentWallet class** - `8fac8ba` (feat)
2. **Task 2: Add factory function and exports** - `2b20880` (feat)

**Plan metadata:** (pending this commit)

## Files Created/Modified

- `src/wallet/mpc-agent-wallet.ts` - MPCAgentWallet class with BRC-100 implementation and MPC types
- `src/wallet/index.ts` - Export MPCAgentWallet, factory, and types
- `src/index.ts` - Re-export MPC wallet from package entry point

## Decisions Made

1. **Interface-only implementation** - MPC modules (MPCWallet, MPCClient, etc.) are external to this package. The implementation uses dependency injection to accept either a pre-configured MPC wallet or a factory function. This aligns with the project constraint that "MPC wallet implementation is external (interface only in this project)".

2. **Dependency injection pattern** - Two injection options:
   - `mpcWallet`: Inject pre-configured MPC wallet instance
   - `mpcWalletFactory`: Inject factory function to create wallets

   This enables testing with mocks and production use with real MPC implementation.

3. **Signing lock pattern** - MPC protocol requires exclusive access to key shares during signing. Concurrent sessions corrupt WASM state. The `withSigningLock<T>()` pattern serializes `createSignature()` and `createAction()` calls.

## Deviations from Plan

### Adaptation Required

**1. MPC modules not in published wallet-toolbox**
- **Found during:** Task 1 (initial implementation)
- **Issue:** The plan specified imports from `@bsv/wallet-toolbox/out/src/mpc/*` but these don't exist in the published npm package - they're in the MPC-DEV repository
- **Adaptation:** Changed to interface-only implementation with dependency injection instead of direct MPC module usage
- **Impact:** Code is cleaner and more testable; requires MPC implementation to be injected at runtime

**2. Created IMPCWallet interface**
- **Found during:** Task 1 (interface design)
- **Issue:** Without the actual MPC types, needed compatible interface definition
- **Adaptation:** Created IMPCWallet interface that mirrors MPCWallet from wallet-toolbox-mpc, enabling type-safe dependency injection
- **Impact:** Consumer code can implement this interface for testing or use real MPC implementation

---

**Total deviations:** 1 adaptation (external dependency not available in published package)
**Impact on plan:** Design improved - interface-only with DI is cleaner than hard dependency

## Issues Encountered

None - build and type checking pass successfully.

## Next Phase Readiness

- MPCAgentWallet ready for use with injected MPC implementation
- Can be tested with mock implementations
- When wallet-toolbox-mpc is published, consumers can create MPCWallet and inject it
- Next plan (03-02) should add integration with certificate authority for MPC-signed certificates

---
*Phase: 03-mpc-wallet-interface*
*Completed: 2026-02-15*
