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
  const listArgs = {
    basket: 'agent-memories',
    tags: options?.tags ? ['agidentity memory', ...options.tags] : ['agidentity memory'],
    include: 'locking scripts',
    includeCustomInstructions: true,
  };
  console.log(`[MemoryReader] listOutputs args: ${JSON.stringify(listArgs)}`);
  const result = await underlyingWallet.listOutputs(listArgs);
  console.log(`[MemoryReader] listOutputs returned ${result.outputs.length} outputs, totalOutputs: ${result.totalOutputs}`);

  // 2. Extract UHRP URLs from PushDrop fields and download
  const memories: Memory[] = [];
  const downloader = new StorageDownloader({ networkPreset: network });

  for (let idx = 0; idx < result.outputs.length; idx++) {
    const output = result.outputs[idx];
    try {
      console.log(`[MemoryReader] Output ${idx}: outpoint=${output.outpoint}, spendable=${output.spendable}, hasLockingScript=${!!output.lockingScript}, customInstructions=${output.customInstructions}`);

      // Skip if not spendable (already spent/deleted)
      if (!output.spendable) { console.log(`[MemoryReader] Output ${idx}: skipped (not spendable)`); continue; }

      // Extract fields from PushDrop token
      if (!output.lockingScript) { console.log(`[MemoryReader] Output ${idx}: skipped (no lockingScript)`); continue; }

      const decoded = PushDrop.decode(LockingScript.fromHex(output.lockingScript), 'before');
      const [uhrpUrlBytes, tagsBytes, importanceBytes] = decoded.fields;

      // Decode byte arrays to strings
      const uhrpUrl = new TextDecoder().decode(new Uint8Array(uhrpUrlBytes));
      const tagsStr = new TextDecoder().decode(new Uint8Array(tagsBytes));
      const importance = new TextDecoder().decode(new Uint8Array(importanceBytes));
      console.log(`[MemoryReader] Output ${idx}: uhrpUrl=${uhrpUrl}, tags=${tagsStr}, importance=${importance}`);

      // Apply importance filter if specified
      if (options?.importance && importance !== options.importance) {
        console.log(`[MemoryReader] Output ${idx}: skipped (importance filter)`);
        continue;
      }

      // 3. Download encrypted content from UHRP (or extract embedded data)
      let ciphertextBytes: Uint8Array;

      if (uhrpUrl === 'embedded' && decoded.fields.length >= 4) {
        // Embedded mode — encrypted content is in 4th PushDrop field
        ciphertextBytes = new Uint8Array(decoded.fields[3]);
        console.log(`[MemoryReader] Output ${idx}: using embedded data (${ciphertextBytes.length} bytes)`);
      } else {
        console.log(`[MemoryReader] Output ${idx}: downloading from UHRP...`);
        const DOWNLOAD_TIMEOUT_MS = 15_000;
        const downloadResult = await Promise.race([
          downloader.download(uhrpUrl),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`UHRP download timed out after ${DOWNLOAD_TIMEOUT_MS}ms`)), DOWNLOAD_TIMEOUT_MS)
          ),
        ]);
        ciphertextBytes = downloadResult.data;
        console.log(`[MemoryReader] Output ${idx}: downloaded ${ciphertextBytes.length} bytes`);
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
      const effectiveKeyID = keyID || `memory-fallback-${output.outpoint}`;
      console.log(`[MemoryReader] Output ${idx}: decrypting with keyID=${effectiveKeyID} (from customInstructions: ${!!keyID})`);

      const decrypted = await wallet.decrypt({
        ciphertext: Array.from(ciphertextBytes),
        protocolID: [2, 'agidentity memory'],
        keyID: effectiveKeyID,
      });

      // 5. Extract txid from outpoint and fetch timestamp
      const txid = output.outpoint.split(':')[0];
      const createdAt = await getTransactionTimestamp(txid);

      // 6. Build Memory object
      const content = Buffer.from(decrypted.plaintext).toString('utf-8');
      console.log(`[MemoryReader] Output ${idx}: decrypted OK, content length=${content.length}, preview="${content.substring(0, 80)}..."`);
      memories.push({
        outpoint: output.outpoint,
        txid,
        uhrpUrl,
        content,
        tags: tagsStr.split(',').filter(t => t.length > 0),
        importance,
        createdAt, // Block timestamp from ARC API
        beef: undefined,
      });
    } catch (error) {
      // Skip tokens that fail to decrypt/download (may be corrupted)
      console.warn(`[MemoryReader] Output ${idx} FAILED:`, error);
    }
  }

  console.log(`[MemoryReader] Returning ${memories.length} memories (from ${result.outputs.length} outputs)`);
  return memories;
}
