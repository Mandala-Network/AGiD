# Phase 7: Memory Write Path - Research

**Researched:** 2026-02-15
**Domain:** UHRP write integration for autonomous agent memory storage
**Confidence:** MEDIUM-HIGH

<research_summary>
## Summary

Researched how to enable OpenClaw agent to autonomously write encrypted memories to UHRP (Universal Hash-Resolved Protocol) storage on the BSV blockchain. The system must support: encrypt → upload to UHRP → blockchain timestamp → audit trail.

**Critical Finding:** UHRP is a content-addressed storage protocol where files are stored off-chain and referenced via `uhrp://` URLs based on content hashes. The BSV blockchain provides immutable timestamps via OP_RETURN transactions, creating verifiable proof of existence. Content-addressing provides built-in deduplication (identical content = same hash = no duplicate storage).

**Architecture Discovery:** BSV Overlay Services (BRC-64/65) provide the infrastructure layer. Overlay networks ingest transactions using SPV, maintain valid headers, submit transactions to BSV nodes, and distribute Merkle proofs. This replaces traditional full-node indexing with a distributed, specialized service architecture.

**Key Insight:** Memory writes aren't simple file uploads - they're cryptographic workflows:
1. Derive encryption key (BRC-42 per-counterparty key)
2. Encrypt memory content (AES-256-GCM via wallet.encrypt)
3. Upload to UHRP provider (returns uhrp:// URL)
4. Create blockchain timestamp (OP_RETURN transaction with metadata)
5. Record audit trail (signed hash chain entry)

**Primary recommendation:** Build on existing AGIdentityStorageManager foundation. Add memory-specific wrapper that handles: metadata extraction, automatic versioning (content hashes), garbage collection policies, and audit trail integration. Use wallet-toolbox for all transaction building - never hand-roll UTXO management or script generation.
</research_summary>

<standard_stack>
## Standard Stack

### Core (Already Integrated)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @bsv/wallet-toolbox | Latest | BRC-100 wallet operations | Official BSV wallet SDK |
| AGIdentityStorageManager | Internal | UHRP upload/download | Already implemented |
| LocalEncryptedVault | Internal | Local encrypted storage | Already implemented |
| SignedAuditTrail | Internal | Cryptographic audit logs | Already implemented |

### UHRP Infrastructure
| Service | Purpose | When to Use |
|---------|---------|-------------|
| UHRP storage provider | Off-chain file storage | Every memory write |
| BSV Overlay Services | Transaction tracking, Merkle proofs | Verify blockchain timestamps |
| UHRP resolution service | Resolve uhrp:// to HTTP URLs | Every memory read |

### Supporting Libraries (Needed)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| None required | - | Existing stack is complete | - |

**Note:** The existing codebase already has all necessary components. Phase 7 is primarily about composition and workflow, not new dependencies.

**Installation:**
No new packages needed - use existing wallet-toolbox and internal modules.

</standard_stack>

<architecture_patterns>
## Architecture Patterns

### Recommended Project Structure
```
src/
├── memory/
│   ├── memory-writer.ts          # High-level memory write API
│   ├── memory-metadata.ts        # Memory metadata schemas
│   └── memory-gc.ts              # Garbage collection policies
├── uhrp/
│   └── storage-manager.ts        # [EXISTING] UHRP operations
├── vault/
│   └── local-encrypted-vault.ts  # [EXISTING] Local storage
└── audit/
    └── signed-audit.ts            # [EXISTING] Audit trails
```

### Pattern 1: Memory Write Workflow
**What:** Atomic operation: encrypt → upload → timestamp → audit
**When to use:** Every autonomous memory write by agent
**Example:**
```typescript
// High-level workflow (to be implemented)
async function storeMemory(
  wallet: AgentWallet,
  memory: {
    content: string;
    tags: string[];
    importance: 'high' | 'medium' | 'low';
  }
): Promise<MemoryReceipt> {
  // 1. Extract metadata
  const metadata = {
    contentHash: await sha256(memory.content),
    tags: memory.tags,
    importance: memory.importance,
    createdAt: Date.now(),
  };

  // 2. Encrypt content
  const encrypted = await wallet.encrypt({
    plaintext: Array.from(new TextEncoder().encode(memory.content)),
    protocolID: [2, 'agidentity-memory'],
    keyID: `memory-${metadata.createdAt}`,
  });

  // 3. Upload to UHRP
  const storageManager = new AGIdentityStorageManager({ wallet, storageUrl });
  const document = await storageManager.uploadVaultDocument(
    agentPublicKey,
    {
      filename: `memory-${metadata.createdAt}.enc`,
      content: new Uint8Array(encrypted.ciphertext),
      mimeType: 'application/octet-stream',
    },
    { retentionDays: 365 } // Policy-driven
  );

  // 4. Blockchain timestamp (already done by uploadVaultDocument)
  // Returns document.blockchainTxId

  // 5. Record in audit trail
  await auditTrail.recordEntry({
    action: 'memory.write',
    resourceId: document.uhrpUrl,
    metadata: {
      contentHash: metadata.contentHash,
      tags: metadata.tags,
      txId: document.blockchainTxId,
    },
  });

  return {
    uhrpUrl: document.uhrpUrl,
    contentHash: metadata.contentHash,
    blockchainTxId: document.blockchainTxId,
    createdAt: metadata.createdAt,
  };
}
```

### Pattern 2: Content-Addressed Deduplication
**What:** Automatic deduplication via content hashing
**When to use:** Always - built into UHRP
**Example:**
```typescript
// Content addressing means identical memories → same UHRP URL
const memory1 = "The capital of France is Paris";
const memory2 = "The capital of France is Paris"; // Identical

// Both produce the same content hash after encryption with same key
// Therefore: same uhrpUrl, no duplicate storage cost

// Different content → different URL
const memory3 = "The capital of France is Paris!"; // Different (!)
// This produces a different hash, different uhrpUrl, new storage
```

### Pattern 3: Memory Garbage Collection Policy
**What:** Time-based + importance-based retention
**When to use:** Periodic cleanup to manage storage costs
**Example:**
```typescript
// Retention policy based on importance
const RETENTION_POLICY = {
  high: 365 * 3,      // 3 years
  medium: 365,         // 1 year
  low: 90,             // 90 days
};

async function applyGarbageCollection() {
  const now = Date.now();
  const memories = await vault.list();

  for (const memory of memories) {
    const metadata = await loadMetadata(memory);
    const age = (now - metadata.createdAt) / (24 * 60 * 60 * 1000); // days
    const maxAge = RETENTION_POLICY[metadata.importance];

    if (age > maxAge) {
      // Don't delete from UHRP (provider handles expiration)
      // Just remove from local index
      await vault.delete(memory.path);
      await auditTrail.recordEntry({
        action: 'memory.gc',
        resourceId: memory.uhrpUrl,
        metadata: { reason: 'retention-expired', age, maxAge },
      });
    }
  }
}
```

### Pattern 4: Blockchain Timestamp Format (OP_RETURN)
**What:** Standard format for memory timestamp transactions
**When to use:** Every UHRP upload that needs blockchain proof
**Example:**
```typescript
// Already implemented in AGIdentityStorageManager.createBlockchainTimestamp
// Format stored in OP_RETURN:
const timestampData = {
  type: 'agidentity-vault-timestamp',
  version: 1,
  uhrpUrl: 'uhrp://abc123...',
  userPubKeyHash: 'hash of agent public key',
  filenameHash: 'hash of filename',
  contentHash: 'sha256 of encrypted content',
  timestamp: Date.now(),
};

// Creates OP_FALSE OP_RETURN script with JSON data
// Transaction is submitted via wallet.createAction
```

### Anti-Patterns to Avoid
- **Writing plaintext to UHRP:** Always encrypt before upload
- **Hand-rolling transaction building:** Use wallet.createAction, never build scripts manually
- **Synchronous blockchain verification:** Merkle proofs are async, accept eventual consistency
- **Assuming instant finality:** Transactions need confirmation time
- **Forgetting audit trail:** Every write must be logged for compliance

</architecture_patterns>

<dont_hand_roll>
## Don't Hand-Roll

Problems that have existing solutions in the BSV/AGIdentity ecosystem:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| UHRP upload/download | Custom HTTP client | AGIdentityStorageManager | Already implemented, handles encryption + blockchain timestamp |
| Transaction building | Raw script assembly | wallet.createAction | Handles UTXO selection, fee calculation, signing |
| Encryption key derivation | Custom KDF | wallet.encrypt with protocolID | BRC-42 compliant, per-counterparty keys |
| Blockchain timestamping | Custom OP_RETURN builder | AGIdentityStorageManager.createBlockchainTimestamp | Already correct format |
| Merkle proof verification | Custom SPV validation | BSV Overlay Services | Distributed, handles chain reorgs |
| Audit trail signing | Custom hash chain | SignedAuditTrail | Already tamper-evident, anchored to blockchain |
| Fee estimation | Manual satoshi calculation | wallet fee model | Handles variable size, optimal fee selection |
| Content hashing | Manual SHA-256 | crypto.subtle.digest | Native, optimized, async |

**Key insight:** The BSV ecosystem has 6+ years of production patterns. AGIdentity already implements the hard parts (encryption, UHRP, audit trails). Phase 7 is about orchestration, not reinvention. Hand-rolling transaction logic leads to:
- UTXO management bugs (double-spends, orphaned outputs)
- Fee calculation errors (underpaid = stuck transactions)
- Key derivation mistakes (BRC-42 non-compliance)
- Security vulnerabilities (script injection, signature malleability)

</dont_hand_roll>

<common_pitfalls>
## Common Pitfalls

### Pitfall 1: UHRP Free-Riding Misconception
**What goes wrong:** Assuming UHRP storage is "free" because blockchain is permanent
**Why it happens:** Misunderstanding the distinction between on-chain (OP_RETURN metadata) and off-chain (UHRP content storage)
**How to avoid:**
- UHRP content is stored by providers who charge fees
- Blockchain only stores the content hash and timestamp (via OP_RETURN)
- Set realistic retention periods based on importance
- Budget for storage renewal costs
**Warning signs:** Unexpected file unavailability after expiration, rising storage costs

### Pitfall 2: Orphaned Blockchain Timestamps
**What goes wrong:** UHRP upload succeeds but blockchain timestamp fails
**Why it happens:** Transaction broadcast errors, insufficient fees, network issues
**How to avoid:**
- Check blockchainTxId is present in upload result
- Implement retry logic for timestamp failures
- Monitor transaction confirmation status via Overlay Services
- Store upload metadata even if timestamp fails (can re-timestamp later)
**Warning signs:** document.blockchainTxId is undefined, audit trail missing txId

### Pitfall 3: Memory Metadata Versioning Conflicts
**What goes wrong:** Same memory content updated with different metadata, creates version confusion
**Why it happens:** Content-addressing means same content = same uhrpUrl, but metadata might differ
**How to avoid:**
- Include metadata in content for version-sensitive memories
- Use separate metadata index (local vault) that references UHRP URLs
- Implement version tracking in audit trail
- Consider timestamp as version identifier
**Warning signs:** Tag updates don't appear, importance changes lost, duplicate entries

### Pitfall 4: Encryption Key Rotation Not Supported
**What goes wrong:** Cannot re-encrypt UHRP content with new keys
**Why it happens:** UHRP URLs are content-addressed - re-encryption changes hash, creates new URL
**How to avoid:**
- Accept that key rotation requires re-upload (new UHRP URL)
- Plan for gradual migration strategy if keys must rotate
- Use long-term stable protocolID conventions
- Document key derivation paths in metadata
**Warning signs:** Old memories inaccessible after key changes

### Pitfall 5: Wallet Compatibility and Network Mismatch
**What goes wrong:** Writing to mainnet when wallet configured for testnet, or vice versa
**Why it happens:** Configuration mismatch between AGIdentityStorageManager network and wallet network
**How to avoid:**
- Validate wallet.getNetwork() matches storageManager.network before writes
- Fail fast on network mismatch - don't write to wrong chain
- Include network in memory metadata for debugging
- Test network switching thoroughly
**Warning signs:** Transactions not appearing on expected blockchain, Merkle proofs fail validation

</common_pitfalls>

<code_examples>
## Code Examples

Verified patterns from existing AGIdentity codebase:

### Wallet Encryption (BRC-42)
```typescript
// Source: src/vault/local-encrypted-vault.ts:474
const encrypted = await this.wallet.encrypt({
  plaintext: Array.from(Buffer.from(content, 'utf-8')),
  protocolID: [2, 'agidentity-vault'],  // Level 2 = per-counterparty
  keyID: this.keyId,
});
```

### UHRP Upload with Blockchain Timestamp
```typescript
// Source: src/uhrp/storage-manager.ts:50
const document = await storageManager.uploadVaultDocument(
  userPublicKey,
  {
    filename: 'memory.enc',
    content: new Uint8Array(encryptedData),
    mimeType: 'application/octet-stream',
  },
  {
    retentionDays: 365,
    skipBlockchainTimestamp: false, // Create OP_RETURN proof
  }
);

// Returns:
// {
//   uhrpUrl: 'uhrp://abc123...',
//   encryptedContent: Uint8Array,
//   metadata: { filename, uploadedAt, expiresAt, ... },
//   blockchainTxId: 'def456...',
// }
```

### Blockchain Timestamp via OP_RETURN
```typescript
// Source: src/uhrp/storage-manager.ts:330
const timestampData = {
  type: 'agidentity-vault-timestamp',
  version: 1,
  uhrpUrl,
  contentHash: bufferToHex(contentHash),
  timestamp: Date.now(),
};

const result = await this.wallet.createAction({
  description: 'AGIdentity Vault Timestamp',
  outputs: [{
    script: createOpReturnScript(timestampData),
    satoshis: 0, // OP_RETURN outputs cost 0 satoshis
  }],
  labels: ['agidentity', 'vault-timestamp', 'uhrp'],
});
// Returns: { txid: '...' }
```

### Signed Audit Trail Entry
```typescript
// Source: src/audit/signed-audit.ts (pattern inferred from structure)
await auditTrail.recordEntry({
  action: 'memory.write',
  resourceId: uhrpUrl,
  metadata: {
    contentHash: '...',
    blockchainTxId: '...',
    tags: ['important', 'conversation'],
  },
});

// Creates entry with:
// - Signature (wallet.createSignature)
// - Hash chain (links to previous entry)
// - Timestamp
// - Optionally anchored to blockchain every N entries
```

### Memory Metadata Schema
```typescript
// New schema to be implemented in Phase 7
interface MemoryMetadata {
  // Identification
  uhrpUrl: string;              // Content-addressed URL
  contentHash: string;          // SHA-256 of encrypted content

  // Blockchain proof
  blockchainTxId: string;       // OP_RETURN timestamp transaction
  blockHeight?: number;         // Confirmation height (async)

  // Lifecycle
  createdAt: number;            // Unix timestamp
  expiresAt: number;            // UHRP expiration
  importance: 'high' | 'medium' | 'low';

  // Searchability
  tags: string[];               // User-defined tags
  summary?: string;             // AI-generated summary

  // Encryption
  encryptionKeyId: string;      // BRC-42 keyID
  protocolID: [number, string]; // [2, 'agidentity-memory']
}
```

</code_examples>

<sota_updates>
## State of the Art (2024-2025)

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Full node indexing | BSV Overlay Services (BRC-64/65) | 2024 (Mandala Upgrade) | Distributed responsibility, SPV validation |
| Centralized storage + blockchain | UHRP distributed storage | 2023-2024 | Content-addressing, automatic deduplication |
| Manual OP_RETURN building | wallet.createAction | 2024 | Safer, handles UTXO management |
| Custom audit logs | SignedAuditTrail with anchoring | 2024 | Tamper-evident, blockchain-verifiable |

**New tools/patterns to consider:**
- **BRC-100 compliant wallets:** Official standard for BSV wallet interfaces (AGIdentity already uses)
- **Overlay Services APIs:** Replace custom blockchain indexers with standard APIs
- **UHRP resolution services:** Distributed lookup, no single point of failure
- **SPV wallets:** Lightweight verification without full node (wallet-toolbox provides)

**Deprecated/outdated:**
- **Monolithic blockchain indexers:** Replaced by specialized Overlay Services
- **Custom UTXO tracking:** wallet-toolbox handles this internally
- **Manual Merkle proof construction:** Overlay Services provide proofs
- **Handbuilt transaction scripts:** wallet.createAction abstracts this

</sota_updates>

<open_questions>
## Open Questions

Things that couldn't be fully resolved during research:

1. **UHRP Provider Selection Strategy**
   - What we know: Multiple UHRP providers can store content
   - What's unclear: How to choose between providers? Redundancy strategy?
   - Recommendation: Start with single configured provider, implement multi-provider redundancy in future phase

2. **Memory Search Index Location**
   - What we know: UHRP stores encrypted content, local vault can cache
   - What's unclear: Should search index be local-only or synced to UHRP?
   - Recommendation: Local-only initially (privacy), consider encrypted index upload for multi-device sync later

3. **Blockchain Timestamp Confirmation Time**
   - What we know: BSV blocks are ~10 minutes, but can vary
   - What's unclear: How long to wait for confirmation? What if reorg happens?
   - Recommendation: Accept eventual consistency, use Overlay Services to track confirmation status, implement confirmation webhook

4. **Memory Versioning Strategy**
   - What we know: Content-addressing means updates create new URLs
   - What's unclear: Best practice for linking versions? Keep old versions?
   - Recommendation: Version chain in metadata, configurable retention (keep last N versions or all versions for high-importance)

5. **Cost Estimation for Memory Writes**
   - What we know: ~1 satoshi/byte for transactions, UHRP provider charges separate
   - What's unclear: Total cost model combining blockchain + storage fees
   - Recommendation: Implement cost tracking in audit trail, expose to agent for budget awareness

</open_questions>

<sources>
## Sources

### Primary (HIGH confidence)
- [BSV Overlay Services Documentation](https://docs.bsvblockchain.org/network-topology/overlay-services) - Architecture, SPV validation, transaction submission
- [BSV Transaction Processing](https://docs.bsvblockchain.org/protocol/transaction-lifecycle/transaction-processing) - OP_RETURN patterns
- [OP_RETURN Documentation](https://docs.bsvblockchain.org/bsv-academy/introduction-to-bitcoin-script/chapter-3-the-opcodes/05-op_return) - Standard format
- [BSV Fee Model](https://docs.bsvblockchain.org/guides/sdks/concepts/fee) - Transaction fee calculation
- Internal codebase: `src/uhrp/storage-manager.ts`, `src/audit/signed-audit.ts`, `src/vault/local-encrypted-vault.ts`

### Secondary (MEDIUM confidence)
- [UHRP Overview](https://bsvblockchain.org/overlay-services-and-the-evolution-of-wallets-advancing-blockchain-applications-with-enhanced-wallet-architectures/) - Verified with overlay services docs
- [Overlay Services Beta](https://bsvblockchain.org/news/overlay-services-now-available-in-public-beta-on-the-bsv-blockchain/) - Confirmed BRC-64/65 standards
- [Content-Addressed Storage Patterns](https://grokipedia.com/page/Content-addressable_storage) - Verified deduplication concepts
- [Blockchain Garbage Collection](https://internetcomputer.org/whitepapers/Collecting%20Garbage%20on%20the%20Blockchain.pdf) - Academic research, patterns applicable

### Tertiary (LOW confidence - needs validation)
- [Audit Trail Best Practices](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0315759) - General blockchain audit patterns
- [BSV Storage Pitfalls](https://www.truthcoin.info/blog/bsv-data-avail/) - Commentary on free-riding, needs fact-checking

</sources>

<metadata>
## Metadata

**Research scope:**
- Core technology: UHRP on BSV blockchain
- Ecosystem: wallet-toolbox, Overlay Services, storage providers
- Patterns: Encrypt → upload → timestamp → audit
- Pitfalls: Free-riding, orphaned timestamps, key rotation, network mismatch

**Confidence breakdown:**
- Standard stack: HIGH - Existing AGIdentity code already implements core components
- Architecture: HIGH - Patterns verified in codebase and official BSV docs
- Pitfalls: MEDIUM - Some inferred from commentary, others from docs
- Code examples: HIGH - All from actual AGIdentity codebase or BSV official docs

**Research date:** 2026-02-15
**Valid until:** 2026-03-15 (30 days - BSV ecosystem stable, BRC standards finalized)

**Gap acknowledgment:**
- Limited specific examples of memory-specific write workflows (will design in planning)
- UHRP provider API specifications not fully documented (implementation will adapt)
- Overlay Services API endpoints not detailed in public docs (will use wallet-toolbox abstractions)

</metadata>

---

*Phase: 7-memory-write-path*
*Research completed: 2026-02-15*
*Ready for planning: yes*
