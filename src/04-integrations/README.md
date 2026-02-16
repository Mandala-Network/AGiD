# 04-integrations: External Service Integrations

**Purpose:** Integration code for external services

## Folders

### `openclaw/`
**What:** OpenClaw WebSocket client
**Is Tool:** ❌ NO - This connects TO OpenClaw, doesn't run it
**Purpose:** Gateway → OpenClaw communication
**File:** `openclaw-client.ts` (WebSocket client)

**Note:** The AI runs IN OpenClaw. This is how AGIdentity connects to it.

### `shad/`
**What:** Shad (Shannon's Daemon) AI research integration
**Service Type:** External Python subprocess
**Is Tool:** ❌ NO - External service integration
**Purpose:** Complex AI research tasks beyond OpenClaw
**Components:**
- ShadIntegration - Spawn/communicate with Shad
- ShadTempVaultExecutor - Secure temp decryption for Shad
- EncryptedShadVault - UHRP-backed vault for Shad

**Note:** Shad is a SEPARATE AI service. AGIdentity integrates with it.

### `team/`
**What:** Team vault for multi-agent collaboration
**Is Tool:** ❌ NO - Infrastructure for shared agent teams
**Purpose:** Secure shared storage, team member management
**Components:**
- TeamVault - Shared encrypted vault
- SecureTeamVault - Certificate-based team access

---

## Key Distinctions

### OpenClaw
- **The Service:** OpenClaw AI framework (external, runs separately)
- **This Folder:** Client to CONNECT to OpenClaw
- **Not:** OpenClaw itself

### Shad
- **The Service:** Python AI daemon (external subprocess)
- **This Folder:** Integration code to USE Shad
- **Not:** Shad itself

**Key Point:** These are INTEGRATION layers to external services, not the services themselves.
