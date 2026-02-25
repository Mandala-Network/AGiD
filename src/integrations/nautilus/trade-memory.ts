/**
 * Trade Memory Recorder
 *
 * Stores trade events on-chain as encrypted PushDrop tokens with queryable
 * tags via the existing MemoryManager. Provides recall with tag-based filtering.
 *
 * Trade content is encrypted (only the agent can decrypt); tags are plaintext
 * on-chain for efficient querying.
 */

import type { MemoryManager, RecallResult } from "../../storage/memory/memory-manager.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TradeEvent {
  eventType:
    | "trade_submitted"
    | "trade_filled"
    | "trade_denied"
    | "position_opened"
    | "position_closed"
    | "trade_canceled";
  instrument: string;
  side: "BUY" | "SELL";
  orderType?: string;
  quantity: string;
  price?: string;
  fillPrice?: string;
  orderId?: string;
  reasoningHash?: string;
  pnl?: string;
  strategy?: string;
  timestamp: number;
}

export interface RecalledTrade {
  content: string;
  tags: string[];
  importance: string;
  txid: string;
  blockTimestamp: number;
}

export interface RecallTradesOptions {
  instrument?: string;
  side?: string;
  type?: string;
  limit?: number;
}

// ---------------------------------------------------------------------------
// Importance mapping
// ---------------------------------------------------------------------------

const HIGH_IMPORTANCE_EVENTS = new Set<string>([
  "trade_filled",
  "position_closed",
]);

function getImportance(eventType: string): "high" | "medium" {
  return HIGH_IMPORTANCE_EVENTS.has(eventType) ? "high" : "medium";
}

// ---------------------------------------------------------------------------
// TradeMemoryRecorder
// ---------------------------------------------------------------------------

export class TradeMemoryRecorder {
  private readonly _memoryManager: MemoryManager;

  constructor(memoryManager: MemoryManager) {
    this._memoryManager = memoryManager;
  }

  /**
   * Record a trade event on-chain via MemoryManager.
   *
   * Content is encrypted; tags are plaintext for querying.
   * Returns txid + uhrpUrl on success, or null if storage fails.
   * This method never throws -- failures are logged as warnings.
   */
  async recordTrade(
    event: TradeEvent,
  ): Promise<{ txid: string; uhrpUrl: string } | null> {
    try {
      const tags = this.buildTags(event);
      const importance = getImportance(event.eventType);
      const content = JSON.stringify(event);

      const result = await this._memoryManager.store({
        content,
        tags,
        importance,
      });

      return { txid: result.txid, uhrpUrl: result.uhrpUrl };
    } catch (err) {
      console.warn(
        "TradeMemoryRecorder: storage failed:",
        err instanceof Error ? err.message : String(err),
      );
      return null;
    }
  }

  /**
   * Recall trade events from on-chain memory with tag-based filtering.
   */
  async recallTrades(options?: RecallTradesOptions): Promise<RecalledTrade[]> {
    const tags: string[] = ["trade"];
    if (options?.instrument) tags.push(`instrument:${options.instrument}`);
    if (options?.side) tags.push(`side:${options.side}`);
    if (options?.type) tags.push(`type:${options.type}`);

    const result: RecallResult = await this._memoryManager.recall({
      tags,
      limit: options?.limit,
    });

    return result.memories.map((m) => ({
      content: m.content,
      tags: m.tags,
      importance: m.importance,
      txid: m.txid,
      blockTimestamp: m.blockTimestamp,
    }));
  }

  /**
   * Build plaintext tags for a trade event.
   */
  private buildTags(event: TradeEvent): string[] {
    const tags: string[] = [
      "trade",
      `instrument:${event.instrument}`,
      `side:${event.side}`,
      `type:${event.eventType}`,
    ];
    if (event.strategy) {
      tags.push(`strategy:${event.strategy}`);
    }
    return tags;
  }
}
