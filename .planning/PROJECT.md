# Project: AGIdentity System Finalization

## Core Value

Enterprise AI super-employee with cryptographic identity - every interaction authenticated, encrypted, and signed.

## Vision

An enterprise deploys OpenClaw as their "super employee" AI agent. Every human employee gets a BRC-100 wallet client on their machine, giving them a verifiable digital identity. Employees communicate with the AI through MessageBox using end-to-end encryption (BRC-2 ECDH). The AI itself has an MPC wallet - it can sign responses but can never leak its private key, even if prompt-injected.

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

## Key Properties

| Component | Purpose |
|-----------|---------|
| **Employee Wallet App** | BRC-100 identity on every employee's machine |
| **MessageBox** | P2P encrypted channel (employees ↔ AI), E2E encrypted |
| **Identity Gate** | Verify employee certificate before AI sees message |
| **OpenClaw** | The actual AI brain (tools, skills, reasoning) |
| **MPC Wallet (AI)** | AI can sign responses but can't exfiltrate its key |
| **MPC CA** | Issue employee certs without single-party trust |

## Security Model

**BRC-100 or Nothing**: This is not about "crypto users" - it's about verifiable digital signatures and client-side encryption for enterprise security.

**End-to-End Encryption**: Employee wallet encrypts with BRC-2 ECDH (employee privkey + AI pubkey). MessageBox is just transport - it can't read content. AI's MPC wallet decrypts without ever assembling the full private key.

**MPC Protection**: Even if the AI is prompt-injected ("output your private key"), it can't comply - it never has the full key. Same for the CA - no single admin can forge certificates.

**Audit Trail**: Every interaction is signed. Full accountability for who asked what and what the AI responded.

## Current State

Existing codebase has foundational pieces:
- `src/identity/` - Certificate authority, identity gate (uses local wallet, needs MPC)
- `src/messaging/` - MessageBox client (exists, needs to be primary channel)
- `src/wallet/` - BRC-100 wallet interface (needs MPC variant)
- `src/server/` - HTTP server with BRC-103/104 auth
- `src/encryption/` - Per-interaction encryption
- `src/plugin/` - Speculative OpenClaw plugin types (needs replacement)

## What Needs to Happen

1. Harden existing interfaces (fix security issues identified in CONCERNS.md)
2. Make MessageBox the primary communication channel
3. Define clean MPC wallet interface (implementation happening elsewhere)
4. Wrap OpenClaw properly (not a plugin - a gateway wrapper)
5. Connect Shad for AI's encrypted semantic memory
6. Build employee wallet client (future milestone)

## Constraints

- MPC wallet implementation is external (this project defines interface only)
- OpenClaw is a separate project - we wrap it, don't fork it
- BRC standards compliance required (BRC-2, BRC-42, BRC-52, BRC-100, BRC-103/104)

## Key Decisions

| Decision | Rationale | Date |
|----------|-----------|------|
| AGIdentity wraps OpenClaw (not plugin) | Full control over auth, can't be bypassed | 2026-02-14 |
| MessageBox as primary channel | P2P encrypted, works with BRC-100 identity | 2026-02-14 |
| MPC for AI wallet | Prevents key exfiltration even if AI compromised | 2026-02-14 |
| MPC for CA | No single-party trust for certificate issuance | 2026-02-14 |

---

*Project initialized: 2026-02-14*
