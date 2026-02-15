# Roadmap: AGIdentity System Finalization

## Overview

Transform AGIdentity from a collection of components into a production-ready enterprise AI gateway. The system wraps OpenClaw with cryptographic identity, making every interaction authenticated, encrypted end-to-end via MessageBox, and signed by an MPC-protected AI wallet.

## Domain Expertise

None (custom enterprise identity system)

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

- [x] **Phase 1: Interface Hardening** - Fix security issues, add validation, sign audit entries (Complete 2026-02-15)
- [x] **Phase 2: MessageBox Channel** - Complete send/receive flow as primary communication (Complete 2026-02-15)
- [x] **Phase 3: MPC Wallet Interface** - Define interface for MPC wallet integration (Complete 2026-02-15)
- [x] **Phase 3.1: MPC Production Integration** - Connect AGIdentity to real MPC system (INSERTED) (Complete 2026-02-15)
- [x] **Phase 4: OpenClaw Gateway** - Wrap OpenClaw with identity-gated access (Complete 2026-02-15)
- [ ] **Phase 5: Shad Semantic Memory** - Connect encrypted vault for AI long-term memory (In progress)

## Phase Details

### Phase 1: Interface Hardening
**Goal**: Fix security issues identified in codebase audit - JSON validation, signed audit entries, proper error handling
**Depends on**: Nothing (first phase)
**Research**: Unlikely (internal patterns, fixing known issues)
**Plans**: TBD

Key work:
- Add Zod validation to all JSON parsing points
- Sign audit trail entries (currently empty string)
- Fix hash truncation vulnerability (64-bit → 256-bit)
- Add session cleanup to prevent memory leaks
- Distinguish error types in vault decryption

Files: `src/vault/local-encrypted-vault.ts`, `src/team/team-vault.ts`, `src/audit/signed-audit.ts`, `src/plugin/*.ts`

### Phase 2: MessageBox Channel
**Goal**: Make MessageBox the primary channel for employee ↔ AI communication with full send/receive flow
**Depends on**: Phase 1
**Research**: Unlikely (MessageBox SDK already integrated)
**Plans**: TBD

Key work:
- Complete message receiving flow (listen for incoming)
- Complete message sending flow (AI responses back to employee)
- Handle message encryption/decryption with BRC-2 ECDH
- Integrate with Identity Gate for sender verification
- Add conversation threading/session management

Files: `src/messaging/message-client.ts`, `src/identity/identity-gate.ts`

### Phase 3: MPC Wallet Interface
**Goal**: Define clean interface for MPC wallet so AI can sign but never access full private key
**Depends on**: Phase 2
**Research**: Likely (MPC protocol, interface requirements)
**Research topics**: MPC wallet protocol being built elsewhere, signing interface, key derivation compatibility
**Plans**: TBD

Key work:
- Define MPC wallet interface extending BRC100Wallet
- Stub implementation for testing
- Integration points for external MPC service
- Update certificate authority to use MPC for signing
- Ensure BRC-42/43 key derivation works with MPC

Files: `src/wallet/mpc-wallet-interface.ts` (new), `src/identity/certificate-authority.ts`

### Phase 3.1: MPC Production Integration (INSERTED)
**Goal**: Connect AGIdentity to the real MPC system so the AI agent can actually use threshold signatures
**Depends on**: Phase 3
**Research**: None (MPC-DEV already researched)
**Plans**: TBD

Key work:
- Link or copy wallet-toolbox-mpc into AGIdentity
- Create `createProductionMPCWallet()` that initializes real MPCWallet
- Handle DKG (first run) vs restore (subsequent runs)
- Cosigner server deployment scripts (Docker/systemd)
- Integration test with local cosigners

Files: `src/wallet/mpc-integration.ts` (new), Dockerfile for cosigners

### Phase 4: OpenClaw Gateway
**Goal**: Wrap OpenClaw so all access goes through AGIdentity's identity gate
**Depends on**: Phase 3.1
**Research**: Likely (OpenClaw Gateway WebSocket protocol)
**Research topics**: OpenClaw Gateway internals, WebSocket control plane, session injection
**Plans**: TBD

Key work:
- Remove speculative plugin types (`src/types/openclaw-plugin.ts`)
- Create AGIdentity Gateway that proxies to OpenClaw Gateway
- MessageBox → Identity Gate → OpenClaw flow
- Inject verified identity context into OpenClaw sessions
- Sign all AI responses with MPC wallet

Files: `src/gateway/` (new), `src/plugin/` (remove or repurpose)

### Phase 5: Shad Semantic Memory
**Goal**: Connect encrypted vault to Shad for AI's long-term memory retrieval
**Depends on**: Phase 4
**Research**: Unlikely (Shad integration code exists)
**Plans**: TBD

Key work:
- Connect EncryptedShadVault to OpenClaw's memory system
- Ensure documents decrypted on-demand for Shad indexing
- Auto-retrieve relevant context before AI responses
- Verify blockchain timestamps for document provenance

Files: `src/shad/shad-integration.ts`, `src/shad/encrypted-vault.ts`

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Interface Hardening | 4/4 | Complete | 2026-02-15 |
| 2. MessageBox Channel | 3/3 | Complete | 2026-02-15 |
| 3. MPC Wallet Interface | 1/1 | Complete | 2026-02-15 |
| 3.1. MPC Production Integration | 1/1 | Complete | 2026-02-15 |
| 4. OpenClaw Gateway | 3/3 | Complete | 2026-02-15 |
| 5. Shad Semantic Memory | 2/3 | In progress | - |

## Future Milestone: Employee Wallet Client

Not in current scope, but next after system finalization:
- Desktop app (Electron or native) for employees
- BRC-100 wallet with key management
- MessageBox UI for chatting with AI
- Certificate enrollment flow

---

*Roadmap created: 2026-02-14*
