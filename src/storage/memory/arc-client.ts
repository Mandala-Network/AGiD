/**
 * ARC Client
 *
 * Shared TAAL ARC API client for fetching transaction timestamps.
 * Used by memory-reader.ts, memory-gc.ts, and MemoryManager.
 */

const ARC_API_URL = process.env.AGID_ARC_API_URL ?? 'https://api.taal.com/arc/v1';
const ARC_API_KEY = process.env.AGID_ARC_API_KEY ?? '';

export interface ARCTransactionInfo {
  blockTime?: number;
  blockHash?: string;
  blockHeight?: number;
}

/**
 * Get transaction timestamp from TAAL ARC API.
 * Returns millisecond epoch. Falls back to Date.now() on failure.
 */
export async function getTransactionTimestamp(txid: string): Promise<number> {
  try {
    const response = await fetch(`${ARC_API_URL}/tx/${txid}`, {
      headers: ARC_API_KEY ? { 'Authorization': `Bearer ${ARC_API_KEY}` } : {},
    });

    if (!response.ok) {
      console.warn(`ARC API error for ${txid}: ${response.status}`);
      return Date.now();
    }

    const data = await response.json() as ARCTransactionInfo;

    if (data.blockTime) {
      return data.blockTime * 1000; // seconds → ms
    }

    return Date.now();
  } catch (error) {
    console.warn(`Failed to fetch timestamp for ${txid}:`, error);
    return Date.now();
  }
}
