/**
 * Memory Writer
 *
 * Implements PushDrop-based memory write workflow:
 * encrypt → UHRP upload → PushDrop tokenization → wallet basket storage
 */

import { StorageUploader } from '@bsv/sdk';
import { PushDrop } from '@bsv/sdk';
import type { AgentWallet } from '../../01-core/wallet/agent-wallet.js';
import type { MemoryInput, MemoryToken } from './memory-types.js';

/**
 * Store a memory with cryptographic ownership proof
 *
 * Creates a PushDrop token (BRC-48) containing:
 * - Encrypted memory content uploaded to UHRP
 * - Tags and importance metadata in token fields
 * - Ownership locked to agent's public key
 * - Stored in 'agent-memories' wallet basket
 *
 * @param wallet - Agent's BRC-100 wallet
 * @param memory - Memory content, tags, and importance
 * @param storageUrl - UHRP storage server URL (default: https://staging-storage.babbage.systems)
 * @returns Memory token with txid and UHRP URL
 */
export async function storeMemory(
  wallet: AgentWallet,
  memory: MemoryInput,
  storageUrl: string = 'https://staging-storage.babbage.systems'
): Promise<MemoryToken> {
  // 1. Encrypt content (ALWAYS encrypted for privacy)
  const plaintext = new TextEncoder().encode(memory.content);
  const encrypted = await wallet.encrypt({
    plaintext: Array.from(plaintext),
    protocolID: [2, 'agidentity-memory'],
    keyID: `memory-${Date.now()}`,
  });

  // 2. Upload encrypted content to UHRP
  const uploader = new StorageUploader({
    storageURL: storageUrl,
    wallet: wallet.getUnderlyingWallet()!,
  });

  const uploadResult = await uploader.publishFile({
    file: {
      data: new Uint8Array(encrypted.ciphertext),
      type: 'application/octet-stream',
    },
    retentionPeriod: 365 * 24 * 60, // 1 year in minutes
  });

  const uhrpUrl = uploadResult.uhrpURL;

  // 3. Create PushDrop token with UHRP URL in data fields
  // Convert strings to byte arrays for PushDrop fields
  const fields: number[][] = [
    Array.from(new TextEncoder().encode(uhrpUrl)),
    Array.from(new TextEncoder().encode(memory.tags.join(','))),
    Array.from(new TextEncoder().encode(memory.importance)),
  ];

  const pushDrop = new PushDrop(wallet.getUnderlyingWallet()!);
  const lockingScript = await pushDrop.lock(
    fields,
    [2, 'agidentity-memory'],  // protocolID
    `memory-${Date.now()}`,     // keyID
    'self',                      // counterparty
    false,                       // forSelf
    true,                        // includeSignature
    'before'                     // lockPosition
  );

  // 4. Create transaction with token output stored in basket
  const result = await wallet.createAction({
    description: `Memory: ${memory.tags.join(', ')}`,
    outputs: [{
      script: lockingScript.toHex(),
      satoshis: 1, // Minimum UTXO value
      basket: 'agent-memories', // Store in basket for retrieval
      tags: ['agidentity-memory', memory.importance, ...memory.tags],
    }],
    labels: ['agidentity-memory', memory.importance, ...memory.tags],
  });

  // 5. Return memory token
  return {
    txid: result.txid,
    uhrpUrl,
    tags: memory.tags,
    importance: memory.importance,
    createdAt: Date.now(),
  };
}
