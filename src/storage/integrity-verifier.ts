/**
 * Integrity Verifier
 *
 * Verifies document integrity by comparing SHA-256 hashes of encrypted
 * content against UHRP URLs stored in PushDrop tokens.
 *
 * - Pre-retrieval: hash encrypted content, compare to token hash
 * - Post-retrieval: attach proof metadata to Shad results
 */

import { createHash } from 'crypto';
import { StorageUtils } from '@bsv/sdk';
import type { ShadRetrievedDocument } from '../types/index.js';

export interface IntegrityResult {
  verified: boolean;
  contentHash: string;
  expectedHash: string;
}

export interface ProofMetadata {
  contentHash: string;
  tokenTxid: string;
  verified: boolean;
}

/**
 * Compute a UHRP URL from encrypted content.
 * Uses the SDK's Base58Check encoding with `ce00` prefix (BRC-48 compliant).
 */
export function computeUhrpUrl(encryptedContent: Uint8Array): string {
  return StorageUtils.getURLForFile(encryptedContent);
}

/**
 * Extract the raw SHA-256 hash from a UHRP URL as hex.
 */
export function extractHash(uhrpUrl: string): string {
  const hashBytes = StorageUtils.getHashFromURL(uhrpUrl);
  return Buffer.from(hashBytes).toString('hex');
}

/**
 * Verify encrypted content against a UHRP URL hash.
 */
export function verifyIntegrity(
  encryptedContent: Uint8Array,
  uhrpUrl: string,
): IntegrityResult {
  const computedHash = createHash('sha256').update(encryptedContent).digest('hex');
  let expectedHash: string;
  try {
    expectedHash = extractHash(uhrpUrl);
  } catch {
    return { verified: false, contentHash: computedHash, expectedHash: uhrpUrl };
  }

  return {
    verified: computedHash === expectedHash,
    contentHash: computedHash,
    expectedHash,
  };
}

/**
 * Verify a batch of encrypted files against their token hashes.
 * Returns a map of path → proof for verified files and a list of failed paths.
 */
export function verifyBatch(
  files: Array<{ path: string; encryptedContent: Uint8Array; uhrpUrl: string; tokenTxid: string }>,
  options?: { strict?: boolean },
): { verified: Map<string, ProofMetadata>; failed: string[] } {
  const verified = new Map<string, ProofMetadata>();
  const failed: string[] = [];

  for (const file of files) {
    const result = verifyIntegrity(file.encryptedContent, file.uhrpUrl);

    if (result.verified) {
      verified.set(file.path, {
        contentHash: result.contentHash,
        tokenTxid: file.tokenTxid,
        verified: true,
      });
    } else {
      console.warn(`[IntegrityVerifier] Hash mismatch for ${file.path}: expected ${result.expectedHash}, got ${result.contentHash}`);
      failed.push(file.path);

      if (options?.strict) {
        throw new Error(`Integrity verification failed for ${file.path} (strict mode)`);
      }
    }
  }

  return { verified, failed };
}

/**
 * Attach proof metadata to Shad retrieved documents.
 */
export function attachProofs(
  docs: ShadRetrievedDocument[],
  proofMap: Map<string, ProofMetadata>,
): ShadRetrievedDocument[] {
  return docs.map(doc => {
    const proof = proofMap.get(doc.path);
    if (proof) {
      return { ...doc, ...proof };
    }
    return { ...doc, verified: false };
  });
}
