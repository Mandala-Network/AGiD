# Roadmap: AGIdentity System Finalization

## Overview

Transform AGIdentity from a collection of components into a production-ready enterprise AI gateway. The system wraps OpenClaw with cryptographic identity, making every interaction authenticated, encrypted end-to-end via MessageBox, and signed by an MPC-protected AI wallet.

## Domain Expertise

None (custom enterprise identity system)

## Milestones

- ✅ **v0.1 AGIdentity System Finalization** (Phases 1-5) — SHIPPED 2026-02-15
- 🚧 **v1.0 Autonomous Agent** (Phases 6-9) — IN PROGRESS

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 3.1 → 4 → 5 → 6 → 7 → 8 → 9

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Interface Hardening | v0.1 | 4/4 | Complete | 2026-02-15 |
| 2. MessageBox Channel | v0.1 | 3/3 | Complete | 2026-02-15 |
| 3. MPC Wallet Interface | v0.1 | 1/1 | Complete | 2026-02-15 |
| 3.1. MPC Production Integration | v0.1 | 1/1 | Complete | 2026-02-15 |
| 4. OpenClaw Gateway | v0.1 | 3/3 | Complete | 2026-02-15 |
| 5. Shad Semantic Memory | v0.1 | 3/3 | Complete | 2026-02-15 |
| 6. Agent Self-Awareness | v1.0 | 1/1 | Complete | 2026-02-15 |
| 7. Memory Write Path | v1.0 | 2/2 | Complete | 2026-02-15 |
| 8. Tool Registry System | v1.0 | 0/? | Not started | - |
| 9. Approval Workflow | v1.0 | 0/? | Not started | - |

---

## 🚧 v1.0 Autonomous Agent (IN PROGRESS)

**Milestone Goal:** Transform OpenClaw from a passive text generator into an autonomous blockchain entity with verifiable identity, on-chain memory, and the ability to transact independently (with MPC protection).

### Phase 6: Agent Self-Awareness ✅
**Goal**: OpenClaw knows its identity and can prove it to others
**Depends on**: Phase 5 (Shad Memory)
**Status**: Complete (1/1 plans)
**Completed**: 2026-02-15

**Deliverables:**
- ✅ Identity tools exposing getIdentity() and proveIdentity()
- ✅ Agent context injection (OpenClaw knows its public key)
- ✅ Identity proof signatures using protocolID [2, 'agent-identity-proof']
- ⏭️ Certificate acquisition workflow for agents (deferred)

### Phase 7: Memory Write Path ✅
**Goal**: Agent can autonomously write memories to UHRP blockchain
**Depends on**: Phase 6
**Status**: Complete (2/2 plans)
**Completed**: 2026-02-15

**Deliverables:**
- ✅ Memory write tool (storeMemory with PushDrop tokenization)
- ✅ Vault write path: encrypt → upload to UHRP → PushDrop ownership token
- ✅ Memory retrieval (listMemories with basket query and UHRP download)
- ✅ Lifecycle management (GC framework with retention policies)
- ⏳ Age-based GC enforcement (deferred to ISS-001 - needs timestamp field)

### Phase 8: Tool Registry System
**Goal**: OpenClaw can discover and execute wallet/MetaNet operations
**Depends on**: Phase 7
**Research**: Likely (OpenClaw function calling integration)
**Research topics**: Claude function calling format, tool execution sandbox, rate limiting
**Plans**: TBD

**Deliverables:**
- Tool registry (discoverable by OpenClaw)
- Safe execution sandbox
- Wallet tools: getBalance, createTransaction, createSignature
- Memory tools: search, store, retrieve
- Cost tracking and rate limiting

### Phase 9: Approval Workflow
**Goal**: Human-in-the-loop for sensitive agent operations
**Depends on**: Phase 8
**Research**: Unlikely (MessageBox approval pattern)
**Plans**: TBD

**Deliverables:**
- Sensitive operation detection
- Approval request via MessageBox
- Time-locked operations
- Cost estimation and user consent
- Approval audit trail

---

## Future Milestone: Employee Wallet Client

Not in current scope, deferred after v1.0:
- Desktop app (Electron or native) for employees
- BRC-100 wallet with key management
- MessageBox UI for chatting with AI
- Certificate enrollment flow

---

*Roadmap created: 2026-02-14*
*v0.1 shipped: 2026-02-15*
*v1.0 started: 2026-02-15*
