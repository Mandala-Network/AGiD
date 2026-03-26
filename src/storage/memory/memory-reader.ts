/**
 * Memory Reader
 *
 * Local-first read flow:
 * 1. Query 'agid-memory' basket for PushDrop tokens
 * 2. Try reading encrypted content from local vault (via coordinator)
 * 3. If local not available, fall back to UHRP download + verify + restore
 * 4. Decrypt with protocol [2, 'agid memory'], keyID "1"
 */

import { PushDrop, StorageDownloader, LockingScript } from '@bsv/sdk';
import type { BRC100Wallet } from '../../types/index.js';
import { getTransactionTimestamp } from './arc-client.js';
import { verifyIntegrity } from '../integrity-verifier.js';
import type { StorageCoordinator } from '../storage-coordinator.js';

const PROTOCOL_ID: [0 | 1 | 2, string] = [2, 'agid memory'];
const KEY_ID = '1';
const BASKET = 'agid-memory';
const DOWNLOAD_TIMEOUT_MS = 15_000;

export interface Memory {
  outpoint: string;
  txid: string;
  uhrpUrl: string;
  content: string;
  tags: string[];
  createdAt: number;
  beef?: number[];
}

export async function listMemories(
  wallet: BRC100Wallet & { getUnderlyingWallet?: () => any },
  options?: { tags?: string[]; coordinator?: StorageCoordinator },
): Promise<Memory[]> {
  const underlyingWallet = wallet.getUnderlyingWallet?.();
  if (!underlyingWallet) {
    throw new Error('Wallet not initialized');
  }

  const network = await wallet.getNetwork();
  const coordinator = options?.coordinator;

  // 1. Query agid-memory basket
  const listArgs = {
    basket: BASKET,
    tags: options?.tags ? ['agid memory', ...options.tags] : ['agid memory'],
    include: 'locking scripts',
    includeCustomInstructions: true,
  };
  const result = await underlyingWallet.listOutputs(listArgs);

  // 2. Decode and decrypt each token
  const memories: Memory[] = [];
  const downloader = new StorageDownloader({ networkPreset: network });

  for (let idx = 0; idx < result.outputs.length; idx++) {
    const output = result.outputs[idx];
    try {
      if (!output.spendable || !output.lockingScript) continue;

      // Decode PushDrop token: [uhrpUrl, tags]
      const decoded = PushDrop.decode(LockingScript.fromHex(output.lockingScript), 'before');
      const [uhrpUrlBytes, tagsBytes] = decoded.fields;

      const uhrpUrl = new TextDecoder().decode(new Uint8Array(uhrpUrlBytes));
      const tagsStr = new TextDecoder().decode(new Uint8Array(tagsBytes));

      // 3. Get encrypted content — local first, then UHRP recovery
      let ciphertextBytes: Uint8Array | null = null;

      // 3a. Try embedded data in token
      if (uhrpUrl === 'embedded' && decoded.fields.length >= 3) {
        ciphertextBytes = new Uint8Array(decoded.fields[2]);
      }

      // 3b. Try local vault via coordinator
      if (!ciphertextBytes && coordinator) {
        const localPaths = await coordinator.list();
        for (const localPath of localPaths) {
          const localContent = await coordinator.read(localPath);
          if (localContent) {
            const decodedContent = Buffer.from(localContent, 'base64');
            const integrity = verifyIntegrity(new Uint8Array(decodedContent), uhrpUrl);
            if (integrity.verified) {
              ciphertextBytes = new Uint8Array(decodedContent);
              break;
            }
          }
        }
      }

      // 3c. Recovery: download from UHRP
      if (!ciphertextBytes) {
        const downloadResult = await Promise.race([
          downloader.download(uhrpUrl),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('UHRP download timed out')), DOWNLOAD_TIMEOUT_MS)
          ),
        ]);
        ciphertextBytes = downloadResult.data;

        // Verify integrity of downloaded content
        const integrity = verifyIntegrity(ciphertextBytes, uhrpUrl);
        if (!integrity.verified) {
          console.warn(`[MemoryReader] Integrity check failed for ${uhrpUrl} — skipping`);
          continue;
        }

        // Restore to local vault
        if (coordinator) {
          const restorePath = `memories/recovered-${output.outpoint.split(':')[0].substring(0, 8)}.enc`;
          await coordinator.write(restorePath, Buffer.from(ciphertextBytes).toString('base64'));
          console.log(`[MemoryReader] Restored ${uhrpUrl} to local vault`);
        }
      }

      // 4. Decrypt
      const decrypted = await wallet.decrypt({
        ciphertext: Array.from(ciphertextBytes),
        protocolID: PROTOCOL_ID,
        keyID: KEY_ID,
      });

      // 5. Get timestamp
      const txid = output.outpoint.split(':')[0];
      const createdAt = await getTransactionTimestamp(txid);

      const content = Buffer.from(decrypted.plaintext).toString('utf-8');
      memories.push({
        outpoint: output.outpoint,
        txid,
        uhrpUrl,
        content,
        tags: tagsStr.split(',').filter(t => t.length > 0),
        createdAt,
      });
    } catch (error) {
      console.warn(`[MemoryReader] Output ${idx} failed:`, error);
    }
  }

  return memories;
}
