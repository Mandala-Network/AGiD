/**
 * Memory Reader
 *
 * Retrieves memories from wallet basket, downloads from UHRP, and decrypts.
 * Uses TAAL ARC API to get block timestamps for age-based lifecycle management.
 */

import { PushDrop, StorageDownloader, LockingScript } from '@bsv/sdk';
import type { BRC100Wallet } from '../../types/index.js';
import { getTransactionTimestamp } from './arc-client.js';

/**
 * Memory object with decrypted content
 */
export interface Memory {
  outpoint: string;
  txid: string;
  uhrpUrl: string;
  content: string;
  tags: string[];
  importance: string;
  createdAt: number; // Block timestamp from ARC API
  beef?: number[]; // Full transaction BEEF for validation
}

/**
 * List memories from wallet basket
 *
 * Queries 'agent-memories' basket for PushDrop tokens, downloads from UHRP,
 * decrypts content, and fetches block timestamps from TAAL ARC API.
 *
 * @param wallet - Agent's BRC-100 wallet
 * @param options - Optional filters for tags and importance
 * @returns Array of decrypted Memory objects with timestamps
 */
export async function listMemories(
  wallet: BRC100Wallet & { getUnderlyingWallet?: () => any },
  options?: { tags?: string[]; importance?: string }
): Promise<Memory[]> {
  // 1. Query basket for memory tokens
  const underlyingWallet = wallet.getUnderlyingWallet?.();
  if (!underlyingWallet) {
    throw new Error('Wallet not initialized');
  }

  const network = await wallet.getNetwork();
  const result = await underlyingWallet.listOutputs({
    basket: 'agent-memories',
    tags: options?.tags ? ['agidentity memory', ...options.tags] : ['agidentity memory'],
    include: 'entire transactions', // Include BEEF for validation
    includeCustomInstructions: true,
  });

  // 2. Extract UHRP URLs from PushDrop fields and download
  const memories: Memory[] = [];
  const downloader = new StorageDownloader({ networkPreset: network });

  for (const output of result.outputs) {
    try {
      // Skip if not spendable (already spent/deleted)
      if (!output.spendable) continue;

      // Extract fields from PushDrop token
      if (!output.lockingScript) continue;

      const decoded = PushDrop.decode(LockingScript.fromHex(output.lockingScript), 'before');
      const [uhrpUrlBytes, tagsBytes, importanceBytes] = decoded.fields;

      // Decode byte arrays to strings
      const uhrpUrl = new TextDecoder().decode(new Uint8Array(uhrpUrlBytes));
      const tagsStr = new TextDecoder().decode(new Uint8Array(tagsBytes));
      const importance = new TextDecoder().decode(new Uint8Array(importanceBytes));

      // Apply importance filter if specified
      if (options?.importance && importance !== options.importance) {
        continue;
      }

      // 3. Download encrypted content from UHRP (or extract embedded data)
      let ciphertextBytes: Uint8Array;

      if (uhrpUrl === 'embedded' && decoded.fields.length >= 4) {
        // Embedded mode — encrypted content is in 4th PushDrop field
        ciphertextBytes = new Uint8Array(decoded.fields[3]);
      } else {
        const DOWNLOAD_TIMEOUT_MS = 15_000;
        const downloadResult = await Promise.race([
          downloader.download(uhrpUrl),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`UHRP download timed out after ${DOWNLOAD_TIMEOUT_MS}ms`)), DOWNLOAD_TIMEOUT_MS)
          ),
        ]);
        ciphertextBytes = downloadResult.data;
      }

      // 4. Decrypt with wallet
      // Parse customInstructions to get keyID
      let keyID: string | undefined;
      if (output.customInstructions) {
        try {
          const instructions = JSON.parse(output.customInstructions);
          keyID = instructions.keyID;
        } catch {
          // If parsing fails, keyID will be undefined
        }
      }

      const decrypted = await wallet.decrypt({
        ciphertext: Array.from(ciphertextBytes),
        protocolID: [2, 'agidentity memory'],
        keyID: keyID || `memory-fallback-${output.outpoint}`,
      });

      // 5. Extract txid from outpoint and fetch timestamp
      const txid = output.outpoint.split(':')[0];
      const createdAt = await getTransactionTimestamp(txid);

      // 6. Build Memory object
      memories.push({
        outpoint: output.outpoint,
        txid,
        uhrpUrl,
        content: Buffer.from(decrypted.plaintext).toString('utf-8'),
        tags: tagsStr.split(',').filter(t => t.length > 0),
        importance,
        createdAt, // Block timestamp from ARC API
        beef: result.BEEF ? (Array.isArray(result.BEEF) ? result.BEEF : Array.from(result.BEEF)) : undefined, // Full transaction BEEF for validation
      });
    } catch (error) {
      // Skip tokens that fail to decrypt/download (may be corrupted)
      console.warn(`Failed to retrieve memory ${output.outpoint}:`, error);
    }
  }

  return memories;
}
