/**
 * Signed Audit Trail
 *
 * Implements Edwin-style cryptographically signed audit logs.
 * Every action is signed by the agent's key and can be anchored
 * to the blockchain for tamper-proof verification.
 *
 * Key features:
 * - All entries are signed with agent's key
 * - Entries form a hash chain (tamper-evident)
 * - Can be anchored to blockchain periodically
 * - User data is hashed, not stored in plaintext
 */

import type {
  BRC100Wallet,
  AuditEntry,
  AuditChain,
  BlockchainAnchor,
} from '../types/index.js';

export interface AuditConfig {
  wallet: BRC100Wallet;
  anchorToBlockchain?: boolean;
  anchorIntervalEntries?: number;
  storagePath?: string;
}

export class SignedAuditTrail {
  private wallet: BRC100Wallet;
  private entries: AuditEntry[] = [];
  private headHash: string = '0'.repeat(64);
  private anchors: BlockchainAnchor[] = [];
  private config: Required<AuditConfig>;

  constructor(config: AuditConfig) {
    this.wallet = config.wallet;
    this.config = {
      wallet: config.wallet,
      anchorToBlockchain: config.anchorToBlockchain ?? false,
      anchorIntervalEntries: config.anchorIntervalEntries ?? 100,
      storagePath: config.storagePath ?? '/tmp/agidentity-audit'
    };
  }

  /**
   * Create a new audit entry
   *
   * Process:
   * 1. Hash user's public key (privacy)
   * 2. Hash input/output (privacy)
   * 3. Include previous entry hash (chain)
   * 4. Sign the entire entry
   * 5. Optionally anchor to blockchain
   */
  async createEntry(params: {
    action: string;
    userPublicKey: string;
    agentPublicKey: string;
    input?: string;
    output?: string;
    metadata?: Record<string, unknown>;
  }): Promise<AuditEntry> {
    const timestamp = Date.now();
    const entryId = `audit-${timestamp}-${this.entries.length}`;

    // Hash sensitive data
    const userPublicKeyHash = await this.hashData(params.userPublicKey);
    const inputHash = params.input ? await this.hashData(params.input) : '';
    const outputHash = params.output ? await this.hashData(params.output) : '';

    // Create entry (without signature)
    const entryData = {
      entryId,
      timestamp,
      action: params.action,
      userPublicKeyHash,
      agentPublicKey: params.agentPublicKey,
      inputHash,
      outputHash,
      previousEntryHash: this.headHash,
      metadata: params.metadata
    };

    // Sign the entry
    const dataToSign = JSON.stringify(entryData);
    const signature = await this.wallet.createSignature({
      data: Array.from(new TextEncoder().encode(dataToSign)),
      protocolID: [0, 'agidentity-audit'],  // Level 0 = publicly verifiable
      keyID: `audit-${entryId}`
    });

    const entry: AuditEntry = {
      ...entryData,
      signature: this.bufferToHex(new Uint8Array(signature.signature))
    };

    // Update chain state
    this.headHash = await this.hashEntry(entry);
    this.entries.push(entry);

    // Check if we should anchor to blockchain
    if (
      this.config.anchorToBlockchain &&
      this.entries.length % this.config.anchorIntervalEntries === 0
    ) {
      await this.anchorToBlockchain();
    }

    return entry;
  }

  /**
   * Verify an audit entry's signature
   */
  async verifyEntry(entry: AuditEntry): Promise<{
    valid: boolean;
    errors: string[];
  }> {
    const errors: string[] = [];

    // Reconstruct data that was signed
    const entryData = {
      entryId: entry.entryId,
      timestamp: entry.timestamp,
      action: entry.action,
      userPublicKeyHash: entry.userPublicKeyHash,
      agentPublicKey: entry.agentPublicKey,
      inputHash: entry.inputHash,
      outputHash: entry.outputHash,
      previousEntryHash: entry.previousEntryHash,
      metadata: entry.metadata
    };

    const dataToVerify = JSON.stringify(entryData);

    // Verify signature
    const result = await this.wallet.verifySignature({
      data: Array.from(new TextEncoder().encode(dataToVerify)),
      signature: Array.from(this.hexToBuffer(entry.signature)),
      protocolID: [0, 'agidentity-audit'],
      keyID: `audit-${entry.entryId}`
    });

    if (!result.valid) {
      errors.push('Invalid signature');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Verify the entire audit chain
   */
  async verifyChain(): Promise<{
    valid: boolean;
    entriesVerified: number;
    errors: Array<{ entryId: string; error: string }>;
  }> {
    const errors: Array<{ entryId: string; error: string }> = [];
    let previousHash = '0'.repeat(64);

    for (const entry of this.entries) {
      // Verify chain linkage
      if (entry.previousEntryHash !== previousHash) {
        errors.push({
          entryId: entry.entryId,
          error: 'Chain linkage broken - previous hash mismatch'
        });
      }

      // Verify signature
      const verification = await this.verifyEntry(entry);
      if (!verification.valid) {
        errors.push({
          entryId: entry.entryId,
          error: verification.errors.join(', ')
        });
      }

      // Update for next iteration
      previousHash = await this.hashEntry(entry);
    }

    return {
      valid: errors.length === 0,
      entriesVerified: this.entries.length,
      errors
    };
  }

  /**
   * Anchor current chain state to blockchain
   */
  async anchorToBlockchain(): Promise<BlockchainAnchor> {
    // Get entries since last anchor
    const lastAnchorIndex = this.anchors.length > 0
      ? this.entries.findIndex(e =>
          e.entryId === this.anchors[this.anchors.length - 1].entryHashes[0])
      : -1;

    const newEntries = this.entries.slice(lastAnchorIndex + 1);
    const entryHashes = await Promise.all(
      newEntries.map(e => this.hashEntry(e))
    );

    // Create Merkle root of entry hashes
    const merkleRoot = await this.computeMerkleRoot(entryHashes);

    // Create OP_RETURN transaction
    const anchorData = {
      type: 'agidentity-audit-anchor',
      version: 1,
      merkleRoot,
      entryCount: entryHashes.length,
      headHash: this.headHash,
      timestamp: Date.now()
    };

    const result = await this.wallet.createAction({
      description: 'AGIdentity Audit Anchor',
      outputs: [{
        script: this.createOpReturnScript(JSON.stringify(anchorData)),
        satoshis: 0
      }],
      labels: ['agidentity', 'audit-anchor']
    });

    const anchor: BlockchainAnchor = {
      txId: result.txid,
      blockHeight: 0,  // Will be set once confirmed
      timestamp: Date.now(),
      entryHashes
    };

    this.anchors.push(anchor);

    return anchor;
  }

  /**
   * Get the current audit chain
   */
  getChain(): AuditChain {
    return {
      entries: [...this.entries],
      headHash: this.headHash,
      blockchainAnchors: [...this.anchors]
    };
  }

  /**
   * Get entries for a specific user (by public key)
   */
  async getEntriesForUser(userPublicKey: string): Promise<AuditEntry[]> {
    const userHash = await this.hashData(userPublicKey);
    return this.entries.filter(e => e.userPublicKeyHash === userHash);
  }

  /**
   * Get entries by action type
   */
  getEntriesByAction(action: string): AuditEntry[] {
    return this.entries.filter(e => e.action === action);
  }

  /**
   * Get entries in time range
   */
  getEntriesInRange(startTime: number, endTime: number): AuditEntry[] {
    return this.entries.filter(
      e => e.timestamp >= startTime && e.timestamp <= endTime
    );
  }

  /**
   * Export audit chain to JSON
   */
  exportToJson(): string {
    return JSON.stringify(this.getChain(), null, 2);
  }

  /**
   * Import audit chain from JSON
   */
  async importFromJson(json: string): Promise<void> {
    const chain: AuditChain = JSON.parse(json);

    // Verify the imported chain
    this.entries = chain.entries;
    this.headHash = chain.headHash;
    this.anchors = chain.blockchainAnchors;

    const verification = await this.verifyChain();
    if (!verification.valid) {
      throw new Error(`Invalid audit chain: ${verification.errors.map(e => e.error).join(', ')}`);
    }
  }

  // =========================================================================
  // Private Helper Methods
  // =========================================================================

  private async hashData(data: string): Promise<string> {
    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(data));
    return this.bufferToHex(new Uint8Array(hashBuffer));
  }

  private async hashEntry(entry: AuditEntry): Promise<string> {
    return this.hashData(JSON.stringify(entry));
  }

  private async computeMerkleRoot(hashes: string[]): Promise<string> {
    if (hashes.length === 0) {
      return '0'.repeat(64);
    }

    if (hashes.length === 1) {
      return hashes[0];
    }

    const nextLevel: string[] = [];
    for (let i = 0; i < hashes.length; i += 2) {
      const left = hashes[i];
      const right = hashes[i + 1] ?? hashes[i];  // Duplicate last if odd
      const combined = await this.hashData(left + right);
      nextLevel.push(combined);
    }

    return this.computeMerkleRoot(nextLevel);
  }

  private createOpReturnScript(data: string): string {
    const dataBytes = new TextEncoder().encode(data);
    const dataHex = this.bufferToHex(dataBytes);
    const pushOp = dataBytes.length < 76
      ? dataBytes.length.toString(16).padStart(2, '0')
      : dataBytes.length < 256
        ? '4c' + dataBytes.length.toString(16).padStart(2, '0')
        : '4d' + dataBytes.length.toString(16).padStart(4, '0');

    return `006a${pushOp}${dataHex}`;
  }

  private bufferToHex(buffer: Uint8Array): string {
    return Array.from(buffer)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  private hexToBuffer(hex: string): Uint8Array {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
    }
    return bytes;
  }
}
