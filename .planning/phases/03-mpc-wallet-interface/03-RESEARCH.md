# Phase 3: MPC Wallet Interface - Research

**Researched:** 2026-02-14
**Domain:** MPC-CMP threshold wallet integration with AGIdentity
**Confidence:** HIGH

<research_summary>
## Summary

Researched the MPC-DEV repository (wallet-toolbox-mpc) for integrating MPC threshold signatures into AGIdentity. The system is **production-ready** with complete distributed key generation (DKG) and threshold signing proven working on BSV testnet.

The wallet-toolbox-mpc provides `MPCWallet` - a BRC-100 compliant wallet that wraps MPC signing behind the standard WalletInterface. This means AGIdentity's existing `AgentWallet` can be **replaced with** or **adapt its interface to match** MPCWallet patterns.

Key architectural insight: The MPC system uses a 3-party (or n-party) threshold scheme where no single party holds the complete private key. For AGIdentity's AI use case, the AI agent would be one party (holding an encrypted share), with 2+ cosigner servers holding other shares. Signing requires all parties to cooperate through a 5-round protocol.

**Primary recommendation:** Create an `MPCAgentWallet` that wraps `MPCWallet` from wallet-toolbox-mpc, adapting the AGIdentity `BRC100Wallet` interface. Use the existing WASM bindings and cosigner infrastructure from MPC-DEV.
</research_summary>

<standard_stack>
## Standard Stack

The MPC-DEV repository already provides a complete stack. AGIdentity should **use these components**, not rebuild them.

### Core
| Library | Location | Purpose | Why Standard |
|---------|----------|---------|--------------|
| wallet-toolbox-mpc | `MPC-DEV/wallet-toolbox-mpc/` | TypeScript MPC wallet | Complete BRC-100 implementation with MPC signing |
| mpc-lib WASM | `MPC-DEV/mpc-lib/` | C++ MPC-CMP protocol | Production-grade crypto, already compiled to WASM |
| MPCWallet | `src/mpc/MPCWallet.ts` | High-level wallet class | BRC-100 compliant, handles DKG and signing |
| MPCClient | `src/mpc/MPCClient.ts` | MPC coordination | Distributed ECDH, BRC-42 derivation, signing |
| WasmBridge | `src/mpc/wasm/WasmBridge.ts` | WASM abstraction | Clean interface to C++ MPC module |

### Supporting
| Library | Location | Purpose | When to Use |
|---------|----------|---------|-------------|
| MPCKeyGenerator | `src/mpc/MPCKeyGenerator.ts` | Key generation | New wallet creation (DKG) |
| MPCKeyDeriver | `src/mpc/MPCKeyDeriver.ts` | BRC-42 derivation | Privacy-preserving derived keys |
| MPCSigningCoordinator | `src/mpc/MPCSigningCoordinator.ts` | Signing orchestration | 5-round signing protocol |
| MPCPersistence | `src/mpc/MPCPersistence.ts` | Database storage | Store shares, derivations, sessions |
| StorageAdapters | `src/mpc/wasm/StorageAdapters.ts` | WASM-TS bridge | Connect TypeScript storage to C++ |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| MPCWallet | Raw MPCClient | MPCWallet is cleaner, BRC-100 compliant |
| wallet-toolbox-mpc | Build from scratch | Would take months, MPC crypto is complex |
| 3-party scheme | 2-party scheme | 3-party more secure, same integration effort |

**Installation:**
```bash
# Copy MPC-DEV into agidentity or use as submodule
cp -r MPC-DEV/wallet-toolbox-mpc agidentity/packages/
cp -r MPC-DEV/mpc-lib agidentity/packages/

# Or better: keep MPC-DEV separate and import
npm link ../MPC-DEV/wallet-toolbox-mpc
```
</standard_stack>

<architecture_patterns>
## Architecture Patterns

### Recommended Project Structure
```
agidentity/
├── src/
│   └── wallet/
│       ├── index.ts              # Exports
│       ├── agent-wallet.ts       # EXISTING: Standard wallet (keep for non-MPC)
│       ├── mpc-agent-wallet.ts   # NEW: MPC wallet adapter
│       └── mpc-types.ts          # NEW: MPC-specific types
├── packages/
│   └── wallet-toolbox-mpc/       # Copied/linked from MPC-DEV
│       └── src/mpc/              # MPCWallet, MPCClient, etc.
```

### Pattern 1: MPCWallet Factory Pattern
**What:** Use `MPCWallet.create()` static factory for DKG-based initialization
**When to use:** Creating new AI agent wallets
**Example:**
```typescript
// Source: MPC-DEV/wallet-toolbox-mpc/src/mpc/MPCWallet.ts
import { MPCWallet, MPCClient } from 'wallet-toolbox-mpc/mpc'

// One-time: Create new MPC wallet via DKG
const wallet = await MPCWallet.create({
  userId: aiAgentId,
  walletId: 'ai-agent-001',
  cosigners: [
    { id: 'cosigner-1', endpoint: 'https://cosigner1.enterprise.com' },
    { id: 'cosigner-2', endpoint: 'https://cosigner2.enterprise.com' }
  ],
  storage: storageManager,
  mpcClient: new MPCClient(config),
  authToken: jwtToken,
  userPassword: shareEncryptionPassword,
  onProgress: (info) => console.log(`DKG Round ${info.round}/5`)
})

// Wallet ready for signing
const result = await wallet.createAction({ ... })
```

### Pattern 2: Share Lifecycle Management
**What:** Encrypted share storage with password-based decryption
**When to use:** Every wallet initialization after DKG
**Example:**
```typescript
// Source: wallet-toolbox-mpc patterns
// 1. Load encrypted share from database
const encryptedShare = await persistence.loadShare(walletId, keyIndex)

// 2. Decrypt with user password (or derived from AI agent secret)
const shareBytes = decryptShare(encryptedShare, password)

// 3. Initialize MPCClient
await mpcClient.initialize(shareBytes)

// 4. Load share into WASM for signing
await mpcClient.loadShareIntoWASM(walletId, keyIndex)
await mpcClient.loadMetadataIntoWASM(walletId, keyIndex, metadata)
await mpcClient.loadAuxiliaryKeysIntoWASM(walletId, keyIndex, auxKeys)
```

### Pattern 3: BRC-42 Derived Key Signing
**What:** Privacy-preserving keys for each invoice/transaction
**When to use:** Enterprise transactions requiring unlinkability
**Example:**
```typescript
// Source: MPCClient.ts
// Derive key for specific invoice
const derivation = await mpcClient.deriveBRC42Key({
  keyId: { walletId, keyIndex, collectivePublicKey },
  counterpartyPublicKey: employeePublicKey,
  invoiceNumber: 'invoice-2024-001'
})

// Sign with derived key (offset applied only to user share)
const signature = await mpcClient.signWithDerivedKey(
  derivation,
  messageHash
)
```

### Anti-Patterns to Avoid
- **Exposing raw shares:** Never log, transmit, or store shares unencrypted
- **Single cosigner:** Always use 2+ cosigners for security
- **Skipping metadata reload:** Call `reloadFreshMetadata()` between derived key signatures
- **Hardcoding endpoints:** Use configuration for cosigner URLs
</architecture_patterns>

<dont_hand_roll>
## Don't Hand-Roll

Problems that look simple but have existing solutions in wallet-toolbox-mpc:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| MPC-CMP protocol | Custom threshold crypto | `mpc-lib` WASM module | Years of crypto research, proven secure |
| Key generation | Custom DKG | `MPCKeyGenerator` | 5-round protocol with ZK proofs |
| Signing coordination | Custom round handling | `MPCSigningCoordinator` | Handles timeouts, retries, error recovery |
| BRC-42 derivation | Manual ECDH | `MPCKeyDeriver` | Distributed ECDH with offset caching |
| Share encryption | Custom AES | `encryptShare/decryptShare` | AES-256-GCM with proper key derivation |
| WASM interface | Raw Emscripten calls | `WasmBridge` | Type-safe, memory-managed |
| Storage adapters | Custom callbacks | `StorageAdapters.ts` | Bridges TypeScript to C++ persistence |

**Key insight:** The MPC-CMP protocol is mathematically complex with 10 rounds total (5 keygen + 5 signing). Each round requires correct handling of Paillier encryption, Ring-Pedersen commitments, and zero-knowledge proofs. The existing implementation has been tested with BSV testnet transactions. Building this from scratch would take months and risk subtle cryptographic vulnerabilities.
</dont_hand_roll>

<common_pitfalls>
## Common Pitfalls

### Pitfall 1: Double Metadata Adjustment
**What goes wrong:** ZK proof verification fails on second derived key signature
**Why it happens:** Metadata adjustments persist in WASM between signing operations
**How to avoid:** Call `mpcClient.reloadFreshMetadata(walletId, keyIndex)` before each derived key signing
**Warning signs:** "Proof verification failed" errors on second/third signatures

### Pitfall 2: Missing Auxiliary Keys
**What goes wrong:** MPC signing fails at MTA (multiplicative-to-additive) round
**Why it happens:** Paillier secret key or Ring-Pedersen secret not loaded
**How to avoid:** Always call `loadAuxiliaryKeysIntoWASM()` after `loadMetadataIntoWASM()`
**Warning signs:** "Cannot decrypt MTA message" or "Missing auxiliary keys" errors

### Pitfall 3: Cosigner Timeout During Round 1
**What goes wrong:** DKG times out during first round
**Why it happens:** Round 1 generates Paillier keys (~1200ms) - slowest round
**How to avoid:** Set `roundTimeout` to at least 60000ms (60 seconds)
**Warning signs:** Timeout errors mentioning "round 1" or "Paillier"

### Pitfall 4: Share Not Loaded Before Signing
**What goes wrong:** "Key not found" error during signing
**Why it happens:** Called `createAction()` without loading share into WASM
**How to avoid:** Ensure `loadShareIntoWASM()` completes before any signing
**Warning signs:** "No share for keyId" or "Key not found in storage"

### Pitfall 5: JSON Serialization of Map Objects
**What goes wrong:** `players.get(1)` returns undefined after JSON round-trip
**Why it happens:** TypeScript Maps become plain objects after JSON.stringify/parse
**How to avoid:** Use `getPlayerSafe()` helper from types.ts instead of `.get()`
**Warning signs:** "Cannot read property 'publicShare' of undefined"

### Pitfall 6: Concurrent MPC Signing Operations
**What goes wrong:** Signature verification fails randomly; "state corruption" errors
**Why it happens:** Multiple signing sessions modifying shared WASM state simultaneously
**How to avoid:** Use a signing mutex (`withSigningLock()` pattern from mpc-test-app)
**Warning signs:** Intermittent failures that work when requests are serialized

### Pitfall 7: Derived Key Signing Without Metadata Adjustment
**What goes wrong:** MTA verification fails during derived key signing
**Why it happens:** Cosigners verify MTA proofs against original public shares, but user is signing with derived share
**How to avoid:** In cosigner `getOrCreateSession()`, adjust player 1's publicShare by adding `G * derivationOffset` BEFORE storing metadata in WASM
**Warning signs:** "MTA verification failed" errors only with derived keys, not root key

### Pitfall 8: Missing Deep Copy of Metadata
**What goes wrong:** Metadata adjustments persist across signing sessions
**Why it happens:** JavaScript object references allow mutation of cached metadata
**How to avoid:** `CosignerStorage.getMetadata()` must return `JSON.parse(JSON.stringify(metadata))`
**Warning signs:** First derived key signature works, subsequent ones fail with "double adjustment"
</common_pitfalls>

<code_examples>
## Code Examples

Verified patterns from MPC-DEV documentation and implementation:

### AGIdentity MPC Wallet Adapter Interface
```typescript
// Proposed: src/wallet/mpc-agent-wallet.ts
import { MPCWallet, MPCClient, MPCConfig, MPCPersistence } from 'wallet-toolbox-mpc/mpc'
import type { BRC100Wallet } from '../types/index.js'

export interface MPCAgentWalletConfig {
  /** AI agent identifier */
  agentId: string
  /** Wallet ID */
  walletId: string
  /** Cosigner endpoints */
  cosigners: Array<{ id: string; endpoint: string }>
  /** Password for share encryption */
  sharePassword: string
  /** Network */
  network: 'mainnet' | 'testnet'
  /** Storage path */
  storagePath?: string
}

export class MPCAgentWallet implements BRC100Wallet {
  private mpcWallet: MPCWallet | null = null
  private mpcClient: MPCClient
  private config: MPCAgentWalletConfig

  constructor(config: MPCAgentWalletConfig) {
    this.config = config
    this.mpcClient = new MPCClient({
      partyId: '1', // User is always party 1
      totalParties: config.cosigners.length + 1,
      threshold: config.cosigners.length + 1, // MPC-CMP requires t=n
      parties: [
        { partyId: '1', type: 'user' },
        ...config.cosigners.map((c, i) => ({
          partyId: (i + 2).toString(),
          type: 'cosigner' as const,
          endpoint: c.endpoint
        }))
      ]
    })
  }

  // ... implement BRC100Wallet interface methods
}
```

### Initialize Existing MPC Wallet (Restore)
```typescript
// Source: MPCWallet patterns + MPCClient
async function restoreMPCWallet(
  walletId: string,
  keyIndex: number,
  password: string,
  persistence: MPCPersistence
): Promise<MPCWallet> {
  // 1. Load encrypted share and metadata from database
  const shareData = await persistence.loadShare(walletId, keyIndex)
  if (!shareData) throw new Error(`Share not found for ${walletId}/${keyIndex}`)

  // 2. Decrypt share
  const shareBytes = decryptShare(shareData.encryptedShare, password)

  // 3. Create MPCClient and initialize
  const mpcClient = new MPCClient(config)
  await mpcClient.initialize(shareBytes)

  // 4. Load into WASM
  await mpcClient.loadShareIntoWASM(walletId, keyIndex)
  await mpcClient.loadMetadataIntoWASM(walletId, keyIndex, shareData.mpcMetadata)
  if (shareData.auxiliaryKeys) {
    await mpcClient.loadAuxiliaryKeysIntoWASM(walletId, keyIndex, shareData.auxiliaryKeys)
  }

  // 5. Create MPCKeyDeriver
  const keyId = {
    walletId,
    keyIndex,
    collectivePublicKey: shareData.collectivePublicKey
  }
  const keyDeriver = new MPCKeyDeriver(mpcClient, keyId, persistence, userId)

  // 6. Return configured wallet
  return new MPCWallet({
    chain: 'main',
    keyDeriver,
    storage: storageManager,
    mpcClient,
    persistence,
    userId
  })
}
```

### Signing a Message with MPC
```typescript
// Source: MPCSigningCoordinator + MPCClient
async function signWithMPC(
  mpcClient: MPCClient,
  walletId: string,
  keyIndex: number,
  messageHash: string // 64 hex chars (32 bytes)
): Promise<{ r: string; s: string }> {
  // Ensure metadata is fresh (prevents double-adjustment issues)
  await mpcClient.reloadFreshMetadata(walletId, keyIndex)

  // Create signing session
  const sessionId = crypto.randomUUID()

  // Run 5-round MPC signing protocol
  // This coordinates with cosigners automatically
  const signature = await mpcClient.sign({
    keyId: { walletId, keyIndex, collectivePublicKey },
    messageHash,
    sessionId
  })

  return signature
}
```
</code_examples>

<mpc_test_app_patterns>
## MPC Test App Backend Patterns (CRITICAL)

The `MPC-DEV/mpc-test-app/` directory contains a **complete working implementation** of an MPC wallet backend. This is the authoritative reference for how AGIdentity should integrate MPC.

### Architecture Overview
```
mpc-test-app/
├── backend/                      # USER/CLIENT side
│   ├── src/
│   │   ├── server.ts            # Express API (80KB, feature-rich)
│   │   ├── wallet/
│   │   │   ├── setup.ts         # MPCWallet initialization (DKG + restore)
│   │   │   ├── transaction.ts   # Transaction creation via createAction()
│   │   │   └── crypto-ops.ts    # Encrypt, decrypt, sign, HMAC
│   │   └── cosigners/
│   │       ├── config.ts        # Cosigner endpoint configuration
│   │       └── manager.ts       # Spawn/manage cosigner processes
│
└── cosigner-servers/             # COSIGNER side (deploy 2+ instances)
    └── src/
        ├── server.ts             # Express server with auth
        ├── routes/
        │   ├── keygen.ts         # 5 DKG round endpoints
        │   ├── signing.ts        # 4 signing round endpoints
        │   └── derive.ts         # BRC-42 derivation endpoint
        └── storage/
            └── CosignerStorage.ts # Unified state management
```

### Pattern 1: Wallet Initialization with DKG/Restore
```typescript
// Source: mpc-test-app/backend/src/wallet/setup.ts
export async function initializeWallet(config: WalletInitConfig): Promise<MPCWallet> {
  // 1. Create SQLite storage
  const knexInstance = makeKnex({
    client: 'sqlite3',
    connection: { filename: dbPath },
    useNullAsDefault: true
  })
  const storageKnex = new StorageKnex({
    chain: config.chain || 'main',
    knex: knexInstance,
    commissionSatoshis: 0,
    feeModel: { model: 'sat/kb', value: 100 }
  })
  await storageKnex.migrate(databaseName, identityKey)
  await storageKnex.makeAvailable()
  const storage = new WalletStorageManager(identityKey, storageKnex)

  // 2. Generate JWT for cosigner auth
  const authToken = jwt.sign(
    { clientId: `wallet-${config.walletId}`, partyId: '1', userId: config.userId },
    config.jwtSecret,
    { expiresIn: '1h' }
  )

  // 3. Create MPC client (user is always party 1)
  const mpcClient = new MPCClient({
    partyId: '1',
    totalParties: config.cosignerEndpoints.length + 1,
    threshold: config.cosignerEndpoints.length + 1, // MPC-CMP: threshold = totalParties
    parties: [
      { partyId: '1', type: 'user' },
      ...config.cosignerEndpoints.map((endpoint, i) => ({
        partyId: `${i + 2}`,
        type: 'cosigner' as const,
        endpoint
      }))
    ],
    jwtToken: authToken
  })

  // 4. Check for existing wallet or create new via DKG
  const persistence = new MPCPersistence(knexInstance)
  const existingShare = await persistence.loadShare(config.walletId, 0)

  if (existingShare) {
    // RESTORE existing wallet
    const decryptedShareBytes = decryptShare(existingShare.encryptedShare, config.userPassword)
    await mpcClient.initialize(decryptedShareBytes)

    // CRITICAL: Load all state into WASM
    await mpcClient.loadShareIntoWASM(config.walletId, 0)
    if (existingShare.mpcMetadata) {
      await mpcClient.loadMetadataIntoWASM(config.walletId, 0, existingShare.mpcMetadata)
    }
    if (existingShare.auxiliaryKeys) {
      await mpcClient.loadAuxiliaryKeysIntoWASM(config.walletId, 0, existingShare.auxiliaryKeys)
    }

    // Restore derivations from storage
    const keyDeriver = new MPCKeyDeriver(mpcClient, keyId, persistence, config.userId)
    await keyDeriver.initializeFromStorage()

    // Run health check
    const healthResult = await persistence.startupHealthCheck(config.walletId, 0)
    if (!healthResult.healthy) {
      for (const issue of healthResult.issues) {
        console.warn(`HEALTH: ${issue}`)
      }
    }

    return new MPCWallet({ chain, keyDeriver, storage, mpcClient, persistence, userId })

  } else {
    // CREATE new wallet via DKG (5-round protocol)
    return await MPCWallet.create({
      userId: config.userId,
      walletId: config.walletId,
      cosigners: config.cosignerEndpoints.map((e, i) => ({ id: `cosigner${i+1}`, endpoint: e })),
      storage, mpcClient, authToken,
      userPassword: config.userPassword,
      chain: config.chain || 'main',
      onProgress: (info) => console.log(`DKG Round ${info.round}/5: ${info.message}`)
    })
  }
}
```

### Pattern 2: Cosigner Server Implementation
```typescript
// Source: mpc-test-app/cosigner-servers/src/routes/signing.ts
const signingSessions = new Map<string, WasmBridge>()

async function getOrCreateSession(
  sessionId: string, partyId: number, walletId: string, keyIndex: number, derivationOffset?: string
): Promise<WasmBridge> {
  let bridge = signingSessions.get(sessionId)
  if (!bridge) {
    bridge = new WasmBridge({ playerId: partyId, tenantId: 'default' })

    // Load share from cosigner storage
    const share = cosignerStorage.getShare(walletId, keyIndex)
    if (!share) throw new Error(`No share for wallet ${walletId} key ${keyIndex}`)

    const keyId = CosignerStorage.buildKeyId(walletId, keyIndex)
    bridge.storeKey(keyId, share.toHex(), WasmSignAlgorithm.SECP256K1)
    bridge.storeTenantMapping(keyId, 'default')

    // Load metadata (with derived key adjustment if needed)
    const metadata = cosignerStorage.getMetadata(walletId, keyIndex)
    if (metadata && derivationOffset) {
      // CRITICAL: Adjust player 1's public share for derived key verification
      const player1 = CosignerStorage.getPlayerSafe(metadata, 1)
      if (player1?.publicShare) {
        const offsetPubKey = PrivateKey.fromString(derivationOffset, 'hex').toPublicKey()
        const originalPubKey = PublicKey.fromString(player1.publicShare)
        player1.publicShare = originalPubKey.add(offsetPubKey).toString()
        if (metadata.publicKey) {
          metadata.publicKey = PublicKey.fromString(metadata.publicKey).add(offsetPubKey).toString()
        }
      }
    }
    if (metadata) bridge.storeKeyMetadata(keyId, metadata)

    // CRITICAL: Load auxiliary keys for MTA verification
    const auxiliaryKeys = cosignerStorage.getAuxiliaryKeys(walletId, keyIndex)
    if (auxiliaryKeys) bridge.storeAuxiliaryKeys(keyId, auxiliaryKeys)

    signingSessions.set(sessionId, bridge)
  }
  return bridge
}

// Round 1: MTA Request
router.post('/mta-request', authMiddleware, async (req, res) => {
  const { sessionId, walletId, keyIndex, messageHash, derivationOffset } = req.body
  const bridge = await getOrCreateSession(sessionId, partyId, walletId, keyIndex, derivationOffset)
  const keyId = CosignerStorage.buildKeyId(walletId, keyIndex)

  const ourMtaRequests = await bridge.startSigningSession({
    keyId, txid: sessionId, messageHash,
    playerIds: [1, 2, 3], algorithm: WasmSignAlgorithm.SECP256K1
  })

  res.json({ partyId: config.partyId, data: ourMtaRequests })
})

// Rounds 2, 3, 4 follow same pattern
router.post('/mta-response', ...) // Round 2: Process MTA
router.post('/deltas', ...)       // Round 3: Compute deltas
router.post('/s-shares', ...)     // Round 4: Partial signatures (cleanup session after)
```

### Pattern 3: Cosigner Storage (3 Categories)
```typescript
// Source: mpc-test-app/cosigner-servers/src/storage/CosignerStorage.ts
export class CosignerStorage {
  // In-memory maps keyed by unified key ID (walletId:keyIndex)
  private shares: Map<string, BigNumber> = new Map()
  private metadata: Map<string, MPCKeyMetadata> = new Map()
  private auxiliaryKeys: Map<string, Record<string, unknown>> = new Map()

  static buildKeyId(walletId: string, keyIndex: number): string {
    return `${walletId}:${keyIndex}`  // Always colon separator
  }

  // CRITICAL: Return deep copy of metadata to prevent mutation
  getMetadata(walletId: string, keyIndex: number): MPCKeyMetadata | undefined {
    const keyId = CosignerStorage.buildKeyId(walletId, keyIndex)
    const metadata = this.metadata.get(keyId)
    return metadata ? JSON.parse(JSON.stringify(metadata)) : undefined
  }

  // Handle Map vs plain object after JSON round-trip
  static getPlayerSafe(metadata: MPCKeyMetadata, playerId: number): MPCPlayerInfo | undefined {
    const players = metadata.players
    if (players instanceof Map) return players.get(playerId)
    const playersObj = players as Record<string | number, MPCPlayerInfo>
    return playersObj[playerId] || playersObj[String(playerId)]
  }

  // Save all state atomically after DKG
  saveAll(partyId: string, walletId: string, keyIndex: number, data: {
    share: BigNumber; metadata: MPCKeyMetadata; auxiliaryKeys: Record<string, unknown>
  }): void {
    this.saveShare(partyId, walletId, keyIndex, data.share)
    this.saveMetadata(partyId, walletId, keyIndex, data.metadata)
    this.saveAuxiliaryKeys(partyId, walletId, keyIndex, data.auxiliaryKeys)
  }
}
```

### Pattern 4: Signing Lock (Prevent Concurrent MPC Operations)
```typescript
// Source: mpc-test-app/backend/src/server.ts
/**
 * MPC protocol requires exclusive access to key shares during signing.
 * Concurrent signing sessions corrupt each other's state.
 */
let signingLock: Promise<void> = Promise.resolve()

async function withSigningLock<T>(operation: () => Promise<T>): Promise<T> {
  const currentLock = signingLock
  let releaseLock: () => void

  signingLock = new Promise<void>((resolve) => { releaseLock = resolve })

  try {
    await currentLock
    return await operation()
  } finally {
    releaseLock!()
  }
}

// Usage in transaction creation
app.post('/api/v1/transaction/create', async (req, res) => {
  const txid = await withSigningLock(async () => {
    return await createAndBroadcastTransaction(wallet!, recipient, amount)
  })
  res.json({ success: true, txid })
})
```

### Pattern 5: Transaction via createAction() (Clean Abstraction)
```typescript
// Source: mpc-test-app/backend/src/wallet/transaction.ts
export async function createAndBroadcastTransaction(
  wallet: MPCWallet,
  recipient: string = '1F1Mh13H1yXFhfSsoJfsNnTAHQgSh2MVE',
  amount: number = 1000
): Promise<string> {
  const lockingScript = new P2PKH().lock(recipient).toHex()

  // createAction() handles: input selection, change, MPC signing, broadcast
  const result = await wallet.createAction({
    description: 'MPC Wallet Test Transaction',
    outputs: [{
      lockingScript,
      satoshis: amount,
      outputDescription: 'Test output from MPC wallet'
    }],
    options: { acceptDelayedBroadcast: false }
  })

  return result.txid!
}
```

### Pattern 6: Cosigner Process Management
```typescript
// Source: mpc-test-app/backend/src/cosigners/manager.ts
export async function startCosigners(): Promise<void> {
  const configs = getCosignerConfigs()  // Returns [{partyId:'2', port:8081}, {partyId:'3', port:8082}]

  await Promise.all(configs.map(config => {
    return new Promise<void>((resolve, reject) => {
      const serverProcess = spawn('npx', ['ts-node', 'src/server.ts'], {
        cwd: cosignerPath,
        env: {
          ...process.env,
          PARTY_ID: config.partyId,
          PORT: config.port.toString(),
          JWT_SECRET: config.jwtSecret
        }
      })

      // Listen for startup confirmation
      serverProcess.stdout?.on('data', (data) => {
        if (data.toString().includes('Server started successfully')) resolve()
      })

      setTimeout(() => reject(new Error('Cosigner startup timeout')), 10000)
    })
  }))
}
```
</mpc_test_app_patterns>

<sota_updates>
## State of the Art (2025-2026)

What's in MPC-DEV that represents current best practices:

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| 2-party ECDSA (Lindell) | MPC-CMP (Canetti et al. 2020) | 2020+ | Better security, no trusted dealer |
| Synchronous rounds | Async with timeout handling | Recent | More robust in production |
| Manual WASM bindings | Emscripten with TypeScript types | Recent | Type-safe, easier debugging |
| SQLite only | Knex with SQLite/PostgreSQL | Recent | Production scalability |

**New tools/patterns in the MPC-DEV stack:**
- **DerivationEncryption:** Password-derived keys for derivation data encryption
- **BackupService:** Share backup and recovery with BIP-39 recovery phrases
- **ConsolidationService:** UTXO consolidation with MPC signing
- **DustFilter:** Dust attack protection for MPC wallets

**What MPC-DEV has that Claude's training might not know:**
- Complete 10-round protocol implementation (5 keygen + 5 signing)
- Production-tested on BSV testnet with real transactions
- BRC-42 distributed ECDH for privacy-preserving derivation
- Offset-based derived key signing (only user adds offset)

**Deprecated/outdated:**
- **cannon.js style MPC:** Use the C++ mpc-lib, not JS implementations
- **Manual ZK proofs:** Handled by mpc-lib WASM
- **Raw share arithmetic:** Use BigNumber from @bsv/sdk
</sota_updates>

<open_questions>
## Open Questions

Things that couldn't be fully resolved during research:

1. **Cosigner Deployment for AI Use Case**
   - What we know: MPC-DEV has cosigner-server implementation in TypeScript
   - What's unclear: Where should AI agent cosigners be deployed? Same infrastructure or separate?
   - Recommendation: Start with 2 cosigners on separate infrastructure; enterprise can add more

2. **Share Password Management for AI Agent**
   - What we know: MPCWallet.create() requires `userPassword` for share encryption
   - What's unclear: How should an AI agent store/retrieve this password securely?
   - Recommendation: Derive from AI agent master secret using HKDF; consider HSM for production

3. **Integration with Existing AgentWallet**
   - What we know: AgentWallet uses wallet-toolbox (non-MPC), MPCWallet uses wallet-toolbox-mpc
   - What's unclear: Should we replace AgentWallet entirely or keep both?
   - Recommendation: Keep both; add MPCAgentWallet as new class, let configuration choose

4. **Certificate Authority MPC Integration**
   - What we know: AGIdentity has CertificateAuthority that needs to sign certificates
   - What's unclear: How to integrate MPC signing with certificate issuance flow
   - Recommendation: Plan for Phase 3 - CA uses MPCWallet.createSignature() for certificate signatures
</open_questions>

<sources>
## Sources

### Primary (HIGH confidence) - CRITICAL IMPLEMENTATION REFERENCES
- `MPC-DEV/mpc-test-app/backend/src/wallet/setup.ts` - **CRITICAL**: Complete wallet initialization pattern
- `MPC-DEV/mpc-test-app/backend/src/server.ts` - Working Express API with signing lock pattern
- `MPC-DEV/mpc-test-app/cosigner-servers/src/routes/signing.ts` - Cosigner signing implementation
- `MPC-DEV/mpc-test-app/cosigner-servers/src/storage/CosignerStorage.ts` - Unified storage pattern
- `MPC-DEV/mpc-test-app/cosigner-servers/src/routes/keygen.ts` - DKG round implementation

### Primary (HIGH confidence) - Core Library
- `MPC-DEV/README.md` - System overview, test results, architecture
- `MPC-DEV/wallet-toolbox-mpc/src/mpc/MPCWallet.ts` - Main wallet implementation
- `MPC-DEV/wallet-toolbox-mpc/src/mpc/types.ts` - Type definitions
- `MPC-DEV/wallet-toolbox-mpc/mpc-dev-docs/PHASE_4/PHASE_4.5_INTEGRATION.md` - Integration guide
- `MPC-DEV/wallet-toolbox-mpc/src/mpc/MPCClient.ts` - Client coordination

### Secondary (MEDIUM confidence)
- `MPC-DEV/docs/` - Architecture documents (corporate-mpc-wallet-architecture.md, etc.)
- `MPC-DEV/wallet-toolbox-mpc/mpc-dev-docs/MPC-Extra-Docs/` - Deployment, security, testing guides
- `MPC-DEV/mpc-test-app/backend/src/wallet/transaction.ts` - Transaction creation pattern

### Tertiary (LOW confidence - needs validation)
- None - all findings verified against working source code
</sources>

<metadata>
## Metadata

**Research scope:**
- Core technology: MPC-CMP threshold signatures via wallet-toolbox-mpc
- Ecosystem: @bsv/sdk, @bsv/wallet-toolbox, mpc-lib WASM
- Patterns: Factory pattern, share lifecycle, derived key signing
- Pitfalls: Metadata reload, auxiliary keys, timeout handling

**Confidence breakdown:**
- Standard stack: HIGH - verified against complete implementation in MPC-DEV
- Architecture: HIGH - from official Phase 4.5 integration docs
- Pitfalls: HIGH - documented in code comments and debug guides
- Code examples: HIGH - adapted from working implementation

**Research date:** 2026-02-14
**Valid until:** 2026-03-14 (30 days - MPC-DEV is stable, versioned in repo)
</metadata>

---

*Phase: 03-mpc-wallet-interface*
*Research completed: 2026-02-14*
*Ready for planning: yes*
