# Project: AGIdentity System Finalization

## Core Value

Enterprise AI super-employee with cryptographic identity - every interaction authenticated, encrypted, and signed.

## What This Is

A production-ready enterprise AI gateway that wraps OpenClaw with cryptographic identity. Employees communicate with the AI through MessageBox using end-to-end encryption (BRC-2 ECDH). The AI has an MPC wallet - it can sign responses but can never leak its private key, even if prompt-injected. Memory is stored in encrypted vaults with blockchain-verified provenance.

## Current State (v0.1 shipped)

**Codebase:** 23,598 lines TypeScript across 67 files
**Tech stack:** TypeScript, BRC-100/103/104, MessageBox, MPC wallet, Shad

**What shipped:**
- Interface hardening (security fixes, validation, session cleanup)
- MessageBox as primary P2P encrypted channel
- MPC wallet interface with dependency injection
- Production MPC integration (DKG/restore paths)
- OpenClaw Gateway with identity gate and response signing
- Shad semantic memory with auto-retrieval

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        ENTERPRISE                                │
│                                                                  │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐             │
│  │ Employee A   │ │ Employee B   │ │ Employee C   │             │
│  │ BRC-100      │ │ BRC-100      │ │ BRC-100      │             │
│  │ Wallet App   │ │ Wallet App   │ │ Wallet App   │             │
│  └──────┬───────┘ └──────┬───────┘ └──────┬───────┘             │
│         │                │                │                      │
│         └────────────────┼────────────────┘                      │
│                          │                                       │
│                   MessageBox (P2P)                               │
│              BRC-2 ECDH End-to-End Encrypted                     │
│                          │                                       │
│                          ▼                                       │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                 AGIdentity Gateway                         │  │
│  │                                                            │  │
│  │  ┌─────────────┐    ┌──────────────────────────────────┐  │  │
│  │  │ Identity    │    │         OpenClaw                  │  │  │
│  │  │ Gate        │───►│         (AI Agent)                │  │  │
│  │  │             │    │                                   │  │  │
│  │  │ - Verify    │    │  Tools, Skills, Browser, Canvas  │  │  │
│  │  │   cert      │    │                                   │  │  │
│  │  │ - Check     │    └───────────────┬──────────────────┘  │  │
│  │  │   revocation│                    │                      │  │
│  │  └─────────────┘                    ▼                      │  │
│  │                     ┌──────────────────────────────────┐  │  │
│  │                     │      MPC Wallet                   │  │  │
│  │                     │  (AI signs, CAN'T leak keys)      │  │  │
│  │                     └──────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │           Certificate Authority (MPC-backed)               │  │
│  │     Issues employee certs • Revocation on-chain            │  │
│  └───────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

## Requirements

### Validated

- ✓ JSON validation at all parsing points — v0.1
- ✓ Signed audit trail entries — v0.1
- ✓ Session cleanup for memory management — v0.1
- ✓ MessageBox as primary communication channel — v0.1
- ✓ Certificate exchange protocol — v0.1
- ✓ MPC wallet interface (dependency injection) — v0.1
- ✓ Production MPC integration — v0.1
- ✓ OpenClaw Gateway with identity gate — v0.1
- ✓ Response signing with MPC wallet — v0.1
- ✓ Encrypted semantic memory — v0.1
- ✓ Auto-context retrieval — v0.1

### Active

- [ ] Employee wallet client (desktop app)
- [ ] Certificate enrollment UI
- [ ] MessageBox chat UI
- [ ] Production deployment scripts

### Out of Scope

- Mobile app — desktop-first for enterprise
- Video chat — use external tools
- Offline mode — real-time identity verification is core

## Key Decisions

| Decision | Rationale | Date | Outcome |
|----------|-----------|------|---------|
| AGIdentity wraps OpenClaw (not plugin) | Full control over auth, can't be bypassed | 2026-02-14 | ✓ Good |
| MessageBox as primary channel | P2P encrypted, works with BRC-100 identity | 2026-02-14 | ✓ Good |
| MPC for AI wallet | Prevents key exfiltration even if AI compromised | 2026-02-14 | ✓ Good |
| MPC for CA | No single-party trust for certificate issuance | 2026-02-14 | ✓ Good |
| Dependency injection for MPC | External implementation, testable, clean interface | 2026-02-15 | ✓ Good |
| File dependency for wallet-toolbox-mpc | Enables local iteration without npm publish cycles | 2026-02-15 | ✓ Good |
| OpenClaw failure is non-fatal | Gateway continues, returns error message | 2026-02-15 | ✓ Good |
| No MCP SDK | Created MCP-compatible interface without full dependency | 2026-02-15 | ✓ Good |

## Constraints

- MPC wallet implementation is external (this project defines interface only)
- OpenClaw is a separate project - we wrap it, don't fork it
- BRC standards compliance required (BRC-2, BRC-42, BRC-52, BRC-100, BRC-103/104)

---

*Project initialized: 2026-02-14*
*Last updated: 2026-02-15 after v0.1 milestone*
