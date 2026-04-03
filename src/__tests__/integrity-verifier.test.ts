import { describe, it, expect } from 'vitest';
import { StorageUtils } from '@bsv/sdk';
import {
  verifyIntegrity,
  verifyBatch,
  attachProofs,
  computeUhrpUrl,
  extractHash,
} from '../storage/integrity-verifier.js';
import type { ShadRetrievedDocument } from '../types/index.js';
import { createHash } from 'crypto';

function sha256hex(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

describe('computeUhrpUrl', () => {
  it('produces a valid Base58Check UHRP URL', () => {
    const content = new Uint8Array([1, 2, 3, 4]);
    const url = computeUhrpUrl(content);
    // SDK validation accepts it
    expect(StorageUtils.isValidURL(url)).toBe(true);
  });

  it('round-trips: extractHash recovers the original SHA-256', () => {
    const content = new Uint8Array([10, 20, 30]);
    const url = computeUhrpUrl(content);
    const recovered = extractHash(url);
    expect(recovered).toBe(sha256hex(content));
  });
});

describe('verifyIntegrity', () => {
  it('returns verified for matching content', () => {
    const content = new Uint8Array([10, 20, 30]);
    const uhrpUrl = computeUhrpUrl(content);

    const result = verifyIntegrity(content, uhrpUrl);
    expect(result.verified).toBe(true);
    expect(result.contentHash).toBe(sha256hex(content));
  });

  it('returns not verified for different content', () => {
    const original = new Uint8Array([10, 20, 30]);
    const tampered = new Uint8Array([99, 99, 99]);
    const uhrpUrl = computeUhrpUrl(original);

    const result = verifyIntegrity(tampered, uhrpUrl);
    expect(result.verified).toBe(false);
  });

  it('handles invalid UHRP URLs gracefully', () => {
    const content = new Uint8Array([1, 2, 3]);
    const result = verifyIntegrity(content, 'not-a-valid-url');
    expect(result.verified).toBe(false);
  });
});

describe('verifyBatch', () => {
  it('returns verified map and empty failed for valid files', () => {
    const content = new Uint8Array([1, 2, 3]);
    const uhrpUrl = computeUhrpUrl(content);

    const result = verifyBatch([
      { path: 'a.md', encryptedContent: content, uhrpUrl, tokenTxid: 'tx1' },
    ]);
    expect(result.verified.size).toBe(1);
    expect(result.failed).toHaveLength(0);
    expect(result.verified.get('a.md')?.verified).toBe(true);
  });

  it('adds failed files to failed list in soft mode', () => {
    const content = new Uint8Array([1, 2, 3]);
    const differentContent = new Uint8Array([9, 8, 7]);
    const badUrl = computeUhrpUrl(differentContent);

    const result = verifyBatch([
      { path: 'bad.md', encryptedContent: content, uhrpUrl: badUrl, tokenTxid: 'tx1' },
    ]);
    expect(result.verified.size).toBe(0);
    expect(result.failed).toContain('bad.md');
  });

  it('throws in strict mode on hash mismatch', () => {
    const content = new Uint8Array([1, 2, 3]);
    const differentContent = new Uint8Array([9, 8, 7]);
    const badUrl = computeUhrpUrl(differentContent);

    expect(() => verifyBatch(
      [{ path: 'bad.md', encryptedContent: content, uhrpUrl: badUrl, tokenTxid: 'tx1' }],
      { strict: true },
    )).toThrow('Integrity verification failed');
  });
});

describe('attachProofs', () => {
  it('attaches proof metadata to retrieved documents', () => {
    const docs: ShadRetrievedDocument[] = [
      { path: 'note.md', content: 'hello', confidence: 0.9, source: 'qmd' },
    ];
    const proofMap = new Map<string, { contentHash: string; tokenTxid: string; verified: boolean }>([
      ['note.md', { contentHash: 'abc', tokenTxid: 'tx1', verified: true }],
    ]);

    const result = attachProofs(docs, proofMap);
    expect(result[0].contentHash).toBe('abc');
    expect(result[0].tokenTxid).toBe('tx1');
    expect(result[0].verified).toBe(true);
  });

  it('marks unmatched documents as unverified', () => {
    const docs: ShadRetrievedDocument[] = [
      { path: 'unknown.md', content: 'x', confidence: 0.5, source: 'qmd' },
    ];
    const proofMap = new Map();

    const result = attachProofs(docs, proofMap);
    expect(result[0].verified).toBe(false);
  });
});
