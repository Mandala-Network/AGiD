/**
 * Memory Writer (Local-First)
 *
 * Local-first memory write workflow:
 * 1. Encrypt content with BRC-42 ([2, 'agid memory'], keyID "1")
 * 2. SHA-256 hash the encrypted output → compute UHRP URL locally
 * 3. Store encrypted content to local vault (via StorageCoordinator)
 * 4. Create PushDrop token [uhrpUrl, tags] in 'agid-memory' basket
 * 5. No UHRP upload at write time — deferred to SyncScheduler
 */

import { PushDrop } from '@bsv/sdk';
import type { BRC100Wallet } from '../../types/index.js';
import type { MemoryInput, MemoryToken } from './memory-types.js';
import { computeUhrpUrl } from '../integrity-verifier.js';
import type { StorageCoordinator } from '../storage-coordinator.js';

/** Constants */
export const PROTOCOL_ID: [number, string] = [2, 'agid memory'];
export const KEY_ID = '1';
export const BASKET = 'agid-memory';

/**
 * Store a memory with local-first pattern.
 *
 * @param wallet - Agent's BRC-100 wallet
 * @param memory - Memory content and tags
 * @param coordinator - Storage coordinator for local vault write + dirty tracking
 * @returns Memory token with txid and locally-computed UHRP URL
 */
export async function storeMemory(
  wallet: BRC100Wallet & { getUnderlyingWallet?: () => any },
  memory: MemoryInput,
  coordinator?: StorageCoordinator,
): Promise<MemoryToken> {
  const underlyingWallet = wallet.getUnderlyingWallet?.();
  if (!underlyingWallet) {
    throw new Error('Cannot access underlying wallet for memory storage');
  }

  // 1. Encrypt content
  const plaintext = new TextEncoder().encode(memory.content);
  const encrypted = await wallet.encrypt({
    plaintext: Array.from(plaintext),
    protocolID: PROTOCOL_ID,
    keyID: KEY_ID,
  });

  // 2. Hash encrypted output → compute UHRP URL locally
  const encryptedBytes = new Uint8Array(encrypted.ciphertext);
  const uhrpUrl = computeUhrpUrl(encryptedBytes);

  // 3. Store encrypted content to local vault (adds to dirty list for sync)
  const storagePath = `memories/${memory.tags.join('-') || 'memory'}-${Date.now()}.enc`;
  if (coordinator) {
    await coordinator.write(storagePath, Buffer.from(encryptedBytes).toString('base64'));
  }

  // 4. Create PushDrop token with [uhrpUrl, tags]
  const fields: number[][] = [
    Array.from(new TextEncoder().encode(uhrpUrl)),
    Array.from(new TextEncoder().encode(memory.tags.join(','))),
  ];

  const pushDrop = new PushDrop(underlyingWallet);
  const lockingScript = await pushDrop.lock(
    fields,
    PROTOCOL_ID,
    KEY_ID,
    'self',
    false,
    true,
    'before',
  );

  // 5. Create transaction with token in agid-memory basket
  const result = await wallet.createAction({
    description: `Memory: ${memory.tags.join(', ')}`,
    outputs: [{
      script: lockingScript.toHex(),
      satoshis: 1,
      basket: BASKET,
      tags: ['agid memory', ...memory.tags],
    }],
    labels: ['agid memory', ...memory.tags],
  });

  return {
    txid: result.txid,
    uhrpUrl,
    tags: memory.tags,
    createdAt: Date.now(),
  };
}
