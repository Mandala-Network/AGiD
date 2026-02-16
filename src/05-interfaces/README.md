# 05-interfaces: External Interfaces

**Purpose:** How external code/users interact with AGIdentity

## Folders

### `server/`
**What:** HTTP API server with BRC-103/104 auth
**Is Tool:** ❌ NO - This is an interface/API
**Purpose:** REST API for external access
**Endpoints:** `/api/identity`, `/api/sign`, `/api/encrypt`, etc.
**Used By:** OpenClaw plugin (calls HTTP API to use wallet)

**Note:** OpenClaw tools call these endpoints. The server provides HTTP access to wallet operations.

### `cli/`
**What:** Command-line interface
**Is Tool:** ❌ NO - This is user-facing CLI
**Commands:**
- `agid info` - Show agent identity
- `agid chat <pubkey>` - Chat with agent via MessageBox
**Used By:** YOU (the human user)

### `client/`
**What:** AGIdentity client SDK
**Is Tool:** ❌ NO - This is a library for other apps
**Purpose:** Client library for external apps to call AGIdentity
**Example:** Other apps can use AGIdentityClient to access wallet

### `service/`
**What:** Service composition/factory
**Is Tool:** ❌ NO - This is a factory pattern
**Purpose:** Creates complete AGIdentity instance
**File:** `agidentity-service.ts` - Composes all components

---

## How These Relate

```
External User/App
    ↓
Chooses interface:
    ├─→ server/ (HTTP REST API)
    ├─→ cli/ (Command-line)
    └─→ client/ (SDK library)
         ↓
    All access same core AGIdentity
         ↓
    service/ composes the complete system
```

**Key Point:** These are INTERFACES to AGIdentity, not the core system itself. They're how external code talks to AGIdentity.
