/**
 * Memory Writer
 *
 * Implements PushDrop-based memory write workflow:
 * encrypt → UHRP upload (with timeout) → PushDrop tokenization → wallet basket storage
 *
 * If UHRP upload fails or times out, encrypted content is embedded directly
 * in the PushDrop token fields (works fine for memories under ~50KB).
 */

import { StorageUploader } from '@bsv/sdk';
import { PushDrop } from '@bsv/sdk';
import type { BRC100Wallet } from '../../types/index.js';
import type { MemoryInput, MemoryToken } from './memory-types.js';

const UHRP_TIMEOUT_MS = 15_000; // 15 seconds max for UHRP upload

/**
 * Store a memory with cryptographic ownership proof
 *
 * Creates a PushDrop token (BRC-48) containing:
 * - Encrypted memory content (via UHRP URL or embedded directly)
 * - Tags and importance metadata in token fields
 * - Ownership locked to agent's public key
 * - Stored in 'agent-memories' wallet basket
 *
 * @param wallet - Agent's BRC-100 wallet
 * @param memory - Memory content, tags, and importance
 * @param storageUrl - UHRP storage server URL (default: https://go-uhrp.b1nary.cloud)
 * @returns Memory token with txid and UHRP URL
 */
export async function storeMemory(
  wallet: BRC100Wallet & { getUnderlyingWallet?: () => any },
  memory: MemoryInput,
  storageUrl: string = 'https://go-uhrp.b1nary.cloud'
): Promise<MemoryToken> {
  const underlyingWallet = wallet.getUnderlyingWallet?.();
  if (!underlyingWallet) {
    throw new Error('Cannot access underlying wallet for memory storage');
  }

  // 1. Encrypt content (ALWAYS encrypted for privacy)
  const encryptionKeyID = `memory-${Date.now()}`;
  console.log(`[MemoryWriter] Encrypting with keyID: ${encryptionKeyID}`);
  const plaintext = new TextEncoder().encode(memory.content);
  const encrypted = await wallet.encrypt({
    plaintext: Array.from(plaintext),
    protocolID: [2, 'agidentity memory'],
    keyID: encryptionKeyID,
  });
  console.log(`[MemoryWriter] Encrypted OK, ciphertext length: ${encrypted.ciphertext.length}`);

  // 2. Try UHRP upload with timeout — fall back to embedding in token
  let uhrpUrl = '';
  let embeddedData: number[] | null = null;

  try {
    const uploader = new StorageUploader({
      storageURL: storageUrl,
      wallet: underlyingWallet,
    });

    const uploadResult = await Promise.race([
      uploader.publishFile({
        file: {
          data: new Uint8Array(encrypted.ciphertext),
          type: 'application/octet-stream',
        },
        retentionPeriod: 365 * 24 * 60, // 1 year in minutes
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`UHRP upload timed out after ${UHRP_TIMEOUT_MS}ms`)), UHRP_TIMEOUT_MS)
      ),
    ]);

    uhrpUrl = uploadResult.uhrpURL;
    console.log(`[MemoryWriter] UHRP upload OK: ${uhrpUrl}`);
  } catch (error) {
    console.warn(`[MemoryWriter] UHRP upload failed, embedding in token: ${error instanceof Error ? error.message : error}`);
    embeddedData = Array.from(encrypted.ciphertext);
  }

  // 3. Create PushDrop token
  const fields: number[][] = [
    Array.from(new TextEncoder().encode(uhrpUrl || 'embedded')),
    Array.from(new TextEncoder().encode(memory.tags.join(','))),
    Array.from(new TextEncoder().encode(memory.importance)),
  ];

  // If UHRP failed, embed encrypted content as a 4th field
  if (embeddedData) {
    fields.push(embeddedData);
  }

  const pushDrop = new PushDrop(underlyingWallet);
  const lockingScript = await pushDrop.lock(
    fields,
    [2, 'agidentity memory'],  // protocolID
    `memory-${Date.now()}`,     // keyID
    'self',                      // counterparty
    false,                       // forSelf
    true,                        // includeSignature
    'before'                     // lockPosition
  );

  // 4. Create transaction with token output stored in basket
  const customInstr = JSON.stringify({ keyID: encryptionKeyID });
  console.log(`[MemoryWriter] Creating action with customInstructions: ${customInstr}`);
  console.log(`[MemoryWriter] basket: agent-memories, tags: ${JSON.stringify(['agidentity memory', memory.importance, ...memory.tags])}`);
  const result = await wallet.createAction({
    description: `Memory: ${memory.tags.join(', ')}`,
    outputs: [{
      script: lockingScript.toHex(),
      satoshis: 1, // Minimum UTXO value
      basket: 'agent-memories', // Store in basket for retrieval
      tags: ['agidentity memory', memory.importance, ...memory.tags],
      customInstructions: customInstr,
    }],
    labels: ['agidentity memory', memory.importance, ...memory.tags],
  });
  console.log(`[MemoryWriter] createAction result txid: ${result.txid}`);

  // 5. Return memory token
  return {
    txid: result.txid,
    uhrpUrl: uhrpUrl || `embedded:${result.txid}`,
    tags: memory.tags,
    importance: memory.importance,
    createdAt: Date.now(),
  };
}
