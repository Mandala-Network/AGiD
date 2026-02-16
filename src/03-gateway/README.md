# 03-gateway: AGIdentity Gateway

**Purpose:** The main system - wraps OpenClaw with identity verification

## Folders

### `gateway/`
**What:** AGIdentity Gateway (the complete system)
**Is Tool:** ❌ NO - This IS the container everything runs in
**Flow:** MessageBox → Verify → Decrypt → OpenClaw → Sign → Encrypt → Send
**File:** `agidentity-openclaw-gateway.ts`

### `messaging/`
**What:** MessageBox P2P integration
**Is Tool:** ❌ NO - Message transport infrastructure
**Provides:** Encrypted P2P message receiving/sending
**Components:** MessageBoxGateway, AGIDMessageClient, ConversationManager

### `auth/`
**What:** Session management and authentication
**Is Tool:** ❌ NO - Security infrastructure
**Provides:** BRC-103/104 session tracking, authentication

### `encryption/`
**What:** Encryption strategies
**Is Tool:** ❌ NO - Crypto helpers
**Provides:** PerInteractionEncryption (PFS), SessionEncryption
**Used By:** Gateway, messaging, storage

---

## Gateway Flow

```
1. Message arrives via MessageBox (messaging/)
2. Decrypt with wallet (encryption/)
3. Verify sender identity (auth/ + identity/)
4. Route to OpenClaw
5. OpenClaw processes with tools
6. Sign response with wallet
7. Encrypt for sender (encryption/)
8. Send via MessageBox (messaging/)
```

**Key Point:** This is the WRAPPER around OpenClaw. Not a tool - it's the system.
