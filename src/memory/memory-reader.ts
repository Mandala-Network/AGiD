/**
 * Memory Reader
 *
 * Retrieves memories from wallet basket, downloads from UHRP, and decrypts.
 * Follows basket query pattern from RESEARCH.md.
 */

import { PushDrop, StorageDownloader, LockingScript } from '@bsv/sdk';
import type { AgentWallet } from '../wallet/agent-wallet.js';

/**
 * Memory object with decrypted content
 */
export interface Memory {
  outpoint: string;
  uhrpUrl: string;
  content: string;
  tags: string[];
  importance: string;
  createdAt: number;
}

/**
 * List memories from wallet basket
 *
 * Queries 'agent-memories' basket for PushDrop tokens, downloads from UHRP,
 * and decrypts content using agent's wallet encryption keys.
 *
 * @param wallet - Agent's BRC-100 wallet
 * @param options - Optional filters for tags and importance
 * @returns Array of decrypted Memory objects
 */
export async function listMemories(
  wallet: AgentWallet,
  options?: { tags?: string[]; importance?: string }
): Promise<Memory[]> {
  // 1. Query basket for memory tokens
  const underlyingWallet = wallet.getUnderlyingWallet();
  if (!underlyingWallet) {
    throw new Error('Wallet not initialized');
  }

  const network = await wallet.getNetwork();
  const result = await underlyingWallet.listOutputs({
    basket: 'agent-memories',
    tags: options?.tags ? ['agidentity-memory', ...options.tags] : ['agidentity-memory'],
    include: 'locking scripts',
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

      // 3. Download encrypted content from UHRP
      const downloadResult = await downloader.download(uhrpUrl);

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
        ciphertext: Array.from(downloadResult.data),
        protocolID: [2, 'agidentity-memory'],
        keyID: keyID || `memory-fallback-${output.outpoint}`,
      });

      // 5. Build Memory object
      memories.push({
        outpoint: output.outpoint,
        uhrpUrl,
        content: Buffer.from(decrypted.plaintext).toString('utf-8'),
        tags: tagsStr.split(',').filter(t => t.length > 0),
        importance,
        createdAt: Date.now(), // No createdAt in WalletOutput, use current time
      });
    } catch (error) {
      // Skip tokens that fail to decrypt/download (may be corrupted)
      console.warn(`Failed to retrieve memory ${output.outpoint}:`, error);
    }
  }

  return memories;
}
