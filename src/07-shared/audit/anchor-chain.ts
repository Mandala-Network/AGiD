/**
 * Anchor Chain
 *
 * Hash-chain data structure that captures key decisions during agent execution.
 * Each anchor links to the previous via SHA-256, forming a tamper-evident chain.
 * The Merkle root of all anchors is committed on-chain as a PushDrop token.
 */

// ============================================================================
// Types
// ============================================================================

export type AnchorType = 'session_start' | 'tool_use' | 'memory_write' | 'payment' | 'session_end';

export interface AnchorPoint {
  id: string;
  timestamp: number;
  type: AnchorType;
  dataHash: string;
  previousHash: string;
  summary: string;
  metadata?: Record<string, unknown>;
}

export interface AnchorChainData {
  sessionId: string;
  agentPublicKey: string;
  anchors: AnchorPoint[];
  headHash: string;
  merkleRoot: string;
  createdAt: number;
}

export interface AddAnchorParams {
  type: AnchorType;
  data: Record<string, unknown>;
  summary: string;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// AnchorChain Class
// ============================================================================

export class AnchorChain {
  private sessionId: string;
  private agentPublicKey: string;
  private anchors: AnchorPoint[] = [];
  private headHash: string = '0'.repeat(64);
  private createdAt: number;

  constructor(sessionId: string, agentPublicKey: string) {
    this.sessionId = sessionId;
    this.agentPublicKey = agentPublicKey;
    this.createdAt = Date.now();
  }

  async addAnchor(params: AddAnchorParams): Promise<AnchorPoint> {
    const id = `anchor-${this.anchors.length}`;
    const dataHash = await sha256(JSON.stringify(params.data));

    const anchor: AnchorPoint = {
      id,
      timestamp: Date.now(),
      type: params.type,
      dataHash,
      previousHash: this.headHash,
      summary: params.summary,
      metadata: params.metadata,
    };

    this.headHash = await sha256(JSON.stringify(anchor));
    this.anchors.push(anchor);
    return anchor;
  }

  async getMerkleRoot(): Promise<string> {
    if (this.anchors.length === 0) return '0'.repeat(64);
    const hashes = await Promise.all(
      this.anchors.map((a) => sha256(JSON.stringify(a)))
    );
    return computeMerkleRoot(hashes);
  }

  async verify(): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];
    let previousHash = '0'.repeat(64);

    for (const anchor of this.anchors) {
      if (anchor.previousHash !== previousHash) {
        errors.push(`${anchor.id}: chain linkage broken (expected ${previousHash.substring(0, 12)}..., got ${anchor.previousHash.substring(0, 12)}...)`);
      }
      previousHash = await sha256(JSON.stringify(anchor));
    }

    return { valid: errors.length === 0, errors };
  }

  verifyAgainstOnChain(onChainMerkleRoot: string, computedMerkleRoot: string): boolean {
    return onChainMerkleRoot === computedMerkleRoot;
  }

  serialize(): AnchorChainData {
    return {
      sessionId: this.sessionId,
      agentPublicKey: this.agentPublicKey,
      anchors: [...this.anchors],
      headHash: this.headHash,
      merkleRoot: '', // Caller should compute via getMerkleRoot()
      createdAt: this.createdAt,
    };
  }

  async serializeWithMerkle(): Promise<AnchorChainData> {
    const data = this.serialize();
    data.merkleRoot = await this.getMerkleRoot();
    return data;
  }

  static fromSerialized(data: AnchorChainData): AnchorChain {
    const chain = new AnchorChain(data.sessionId, data.agentPublicKey);
    chain.anchors = [...data.anchors];
    chain.headHash = data.headHash;
    chain.createdAt = data.createdAt;
    return chain;
  }

  getAnchors(): readonly AnchorPoint[] {
    return this.anchors;
  }

  getHeadHash(): string {
    return this.headHash;
  }

  getSessionId(): string {
    return this.sessionId;
  }

  getAnchorCount(): number {
    return this.anchors.length;
  }
}

// ============================================================================
// Helpers
// ============================================================================

export async function sha256(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(data));
  return bufferToHex(new Uint8Array(hashBuffer));
}

export async function computeMerkleRoot(hashes: string[]): Promise<string> {
  if (hashes.length === 0) return '0'.repeat(64);
  if (hashes.length === 1) return hashes[0];

  const nextLevel: string[] = [];
  for (let i = 0; i < hashes.length; i += 2) {
    const left = hashes[i];
    const right = hashes[i + 1] ?? hashes[i];
    const combined = await sha256(left + right);
    nextLevel.push(combined);
  }

  return computeMerkleRoot(nextLevel);
}

function bufferToHex(buffer: Uint8Array): string {
  return Array.from(buffer)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
