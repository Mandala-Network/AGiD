/**
 * Memory Garbage Collection
 *
 * Implements retention policies based on importance levels.
 * Uses TAAL ARC API to get block timestamps for age calculation.
 * Spends expired tokens to remove them from wallet basket.
 */

import { PushDrop, LockingScript, Transaction } from '@bsv/sdk';
import type { AgentWallet } from '../wallet/agent-wallet.js';

/**
 * ARC API configuration
 */
const ARC_API_URL = 'https://api.taal.com/arc/v1';
const ARC_API_KEY = 'mainnet_93c73fb3c89d5d712d75420adf06162b';

/**
 * Retention policy in days based on importance level
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
 * ARC API transaction response
 */
interface ARCTransactionResponse {
  blockTime?: number;
  blockHash?: string;
  blockHeight?: number;
}

/**
 * Get transaction timestamp from TAAL ARC API
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
      return Date.now(); // Fallback to current time (won't be GC'd)
    }

    const data = await response.json() as ARCTransactionResponse;

    // ARC returns blocktime as Unix timestamp (seconds)
    if (data.blockTime) {
      return data.blockTime * 1000; // Convert to milliseconds
    }

    // If not yet mined, use current time (won't be GC'd)
    return Date.now();
  } catch (error) {
    console.warn(`Failed to fetch timestamp for ${txid}:`, error);
    return Date.now(); // Fallback to current time (won't be GC'd)
  }
}

/**
 * Apply garbage collection to memory tokens
 *
 * Queries memory tokens, fetches timestamps from TAAL ARC API, and spends
 * expired ones based on retention policy (high=3yr, medium=1yr, low=90d).
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
    basket: 'agent-memories',
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

      // Extract importance from PushDrop fields
      if (!output.lockingScript) continue;

      const decoded = PushDrop.decode(LockingScript.fromHex(output.lockingScript), 'before');
      const [, , importanceBytes] = decoded.fields;

      const importance = new TextDecoder().decode(new Uint8Array(importanceBytes)) as keyof typeof RETENTION_POLICY;

      // Get timestamp from ARC API
      const txid = output.outpoint.split(':')[0];
      const createdAt = await getTransactionTimestamp(txid);

      // Calculate age in days
      const ageMs = now - createdAt;
      const ageDays = ageMs / (24 * 60 * 60 * 1000);

      // Check if expired based on retention policy
      const maxAgeDays = RETENTION_POLICY[importance];
      if (ageDays > maxAgeDays) {
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
          protocolID: [2, 'agidentity-memory'],
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
