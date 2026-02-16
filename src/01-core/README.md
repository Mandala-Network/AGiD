# 01-core: Core Infrastructure

**Purpose:** Foundational systems that everything else depends on

## Folders

### `wallet/`
**What:** MPC wallet (2-of-3 threshold signatures)
**Is Tool:** ❌ NO - This is infrastructure
**Used By:** Tools, gateway, messaging
**Provides:** Agent's cryptographic identity, signing, encryption primitives

### `identity/`
**What:** Identity verification system (certificates, trust gates)
**Is Tool:** ❌ NO - This is security infrastructure
**Used By:** Gateway, messaging
**Provides:** Verify WHO sent a message, enforce trust policy

### `config/`
**What:** Configuration loading and validation
**Is Tool:** ❌ NO - This is configuration management
**Used By:** Everything
**Provides:** Environment-based configuration, defaults

---

**Key Point:** These are NEVER called by OpenClaw AI. They run in background and provide services to other components.
