/**
 * Memory Garbage Collection
 *
 * Implements flat retention policy for all memories.
 * Uses TAAL ARC API to get block timestamps for age calculation.
 * Spends expired tokens to remove them from wallet basket.
 */

import { PushDrop, LockingScript, Transaction } from '@bsv/sdk';
import type { AgentWallet } from '../../wallet/agent-wallet.js';
import { getTransactionTimestamp } from './arc-client.js';

/**
 * Flat retention policy: all memories retained for 365 days
 */
export const RETENTION_DAYS = 365;

/**
 * GC statistics
 */
export interface GCStats {
  spent: number;
  kept: number;
}

/**
 * Apply garbage collection to memory tokens
 *
 * Queries memory tokens, fetches timestamps from TAAL ARC API, and spends
 * expired ones based on a flat 365-day retention policy.
 *
 * @param wallet - Agent's BRC-100 wallet
 * @returns Statistics on tokens spent and kept
 */
export async function applyGarbageCollection(
  wallet: AgentWallet
): Promise<GCStats> {
  const underlyingWallet = wallet.getUnderlyingWallet();
  if (!underlyingWallet) {
    throw new Error('Wallet not initialized');
  }

  // 1. Query all memory tokens
  const result = await underlyingWallet.listOutputs({
    basket: 'agid-memory',
    include: 'entire transactions', // Include BEEF for spending
    includeCustomInstructions: true,
    limit: 10000, // Get all tokens
  });

  // 2. Check age against retention policy
  const now = Date.now();
  const tokensToSpend: Array<{
    outpoint: string;
    lockingScript: string;
    satoshis: number;
    protocolID: [2, string];
    keyID: string;
  }> = [];

  for (const output of result.outputs) {
    try {
      // Skip if not spendable
      if (!output.spendable) continue;

      // Decode PushDrop fields [uhrpUrl, tags]
      if (!output.lockingScript) continue;

      PushDrop.decode(LockingScript.fromHex(output.lockingScript), 'before');

      // Get timestamp from ARC API
      const txid = output.outpoint.split(':')[0];
      const createdAt = await getTransactionTimestamp(txid);

      // Calculate age in days
      const ageMs = now - createdAt;
      const ageDays = ageMs / (24 * 60 * 60 * 1000);

      // Check if expired based on flat retention policy
      if (ageDays > RETENTION_DAYS) {
        // Parse customInstructions to get keyID
        let keyID = `memory-gc-${output.outpoint}`;
        if (output.customInstructions) {
          try {
            const instructions = JSON.parse(output.customInstructions);
            keyID = instructions.keyID || keyID;
          } catch {
            // Use fallback keyID
          }
        }

        tokensToSpend.push({
          outpoint: output.outpoint,
          lockingScript: output.lockingScript,
          satoshis: output.satoshis,
          protocolID: [2, 'agid memory'],
          keyID,
        });
      }
    } catch (error) {
      console.warn(`Failed to process token ${output.outpoint} for GC:`, error);
    }
  }

  // 3. Spend expired tokens if any
  if (tokensToSpend.length > 0) {
    // Create spending transaction (no outputs = fees only)
    await underlyingWallet.createAction({
      description: 'Memory garbage collection',
      inputs: await Promise.all(tokensToSpend.map(async (token) => {
        const pushDrop = new PushDrop(underlyingWallet);
        const unlockInfo = pushDrop.unlock(
          token.protocolID,
          token.keyID,
          'self',
          'all',
          false,
          token.satoshis,
          LockingScript.fromHex(token.lockingScript)
        );

        // Note: Need to build partial transaction to get unlocking script
        // This is simplified - real implementation needs full tx context
        const dummyTx = new Transaction();
        const unlockingScript = await unlockInfo.sign(dummyTx, 0);

        return {
          outpoint: token.outpoint,
          unlockingScript: unlockingScript.toHex(),
          inputDescription: 'GC: Expired memory token',
        };
      })),
      outputs: [], // No outputs = spent to fees
    });
  }

  // 4. Return stats
  return {
    spent: tokensToSpend.length,
    kept: result.outputs.filter(o => o.spendable).length - tokensToSpend.length,
  };
}
