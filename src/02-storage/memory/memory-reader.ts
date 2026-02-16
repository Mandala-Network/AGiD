/**
 * Memory Reader
 *
 * Retrieves memories from wallet basket, downloads from UHRP, and decrypts.
 * Uses TAAL ARC API to get block timestamps for age-based lifecycle management.
 */

import { PushDrop, StorageDownloader, LockingScript } from '@bsv/sdk';
import type { AgentWallet } from '../../01-core/wallet/agent-wallet.js';

/**
 * ARC API configuration
 */
const ARC_API_URL = 'https://api.taal.com/arc/v1';
const ARC_API_KEY = 'mainnet_93c73fb3c89d5d712d75420adf06162b';

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
 * ARC API transaction response
 */
interface ARCTransactionResponse {
  blockTime?: number;
  blockHash?: string;
  blockHeight?: number;
}

/**
 * Get transaction metadata from TAAL ARC API
 */
async function getTransactionTimestamp(txid: string): Promise<number> {
  try {
    const response = await fetch(`${ARC_API_URL}/tx/${txid}`, {
      headers: {
        'Authorization': `Bearer ${ARC_API_KEY}`,
      },
    });

    if (!response.ok) {
      console.warn(`ARC API error for ${txid}: ${response.status}`);
      return Date.now(); // Fallback to current time
    }

    const data = await response.json() as ARCTransactionResponse;

    // ARC returns blocktime as Unix timestamp (seconds)
    if (data.blockTime) {
      return data.blockTime * 1000; // Convert to milliseconds
    }

    // If not yet mined, use current time
    return Date.now();
  } catch (error) {
    console.warn(`Failed to fetch timestamp for ${txid}:`, error);
    return Date.now(); // Fallback to current time
  }
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
