/**
 * Memory Garbage Collection
 *
 * Implements retention policies based on importance levels.
 * Spends expired tokens to remove them from wallet basket.
 *
 * LIMITATION: Current implementation cannot enforce time-based retention
 * because creation timestamps are not stored in the PushDrop tokens.
 * This requires storing timestamp as a 4th field in future versions.
 * See ISSUES.md for planned enhancement.
 */

import { PushDrop, LockingScript, Transaction } from '@bsv/sdk';
import type { AgentWallet } from '../wallet/agent-wallet.js';

/**
 * Retention policy in days based on importance level
 *
 * NOTE: Currently not enforced due to missing timestamp data.
 * Future enhancement will add timestamp to PushDrop token fields.
 */
export const RETENTION_POLICY = {
  high: 365 * 3,    // 3 years
  medium: 365,       // 1 year
  low: 90,           // 90 days
} as const;

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
 * Queries memory tokens and prepares to spend expired ones based on
 * retention policy. Current implementation returns stats but does not
 * actually spend tokens due to missing timestamp data.
 *
 * LIMITATION: Without creation timestamps in token fields, age-based
 * retention cannot be enforced. All tokens are kept.
 *
 * @param wallet - Agent's BRC-100 wallet
 * @returns Statistics on tokens that would be spent and kept
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
    basket: 'agent-memories',
    include: 'locking scripts',
    includeCustomInstructions: true,
    limit: 10000, // Get all tokens
  });

  // 2. Check tokens (would check age if timestamp available)
  const tokensToSpend: Array<{
    outpoint: string;
    lockingScript: string;
    satoshis: number;
    protocolID: [2, string];
    keyID: string;
  }> = [];

  for (const output of result.outputs) {
    // Skip if not spendable
    if (!output.spendable) continue;

    // LIMITATION: Cannot calculate age without timestamp
    // Future implementation would:
    // 1. Extract importance from PushDrop.decode(lockingScript)
    // 2. Extract timestamp from 4th PushDrop field
    // 3. Calculate age: (Date.now() - timestamp) / (24 * 60 * 60 * 1000)
    // 4. Compare age > RETENTION_POLICY[importance]
    // 5. If expired: add to tokensToSpend with unlock script

    // For now, keep all tokens since we can't determine expiration
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
