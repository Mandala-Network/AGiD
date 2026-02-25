/**
 * Local cache for market data bars received from the bridge.
 *
 * Stores recent bars per instrument per timeframe in ring buffers
 * with configurable capacity. Consumed by BridgeClient to provide
 * `client.marketData.getBars()` accessors.
 */

import { RingBuffer } from "./ring-buffer.js";
import type { DataBarEvent } from "./types.js";

export class MarketDataCache {
  private buffers = new Map<string, RingBuffer<DataBarEvent>>();
  private readonly ringBufferSize: number;

  constructor(ringBufferSize: number = 50) {
    this.ringBufferSize = ringBufferSize;
  }

  /**
   * Composite key for instrument + timeframe lookups.
   * Format: "AAPL:1m"
   */
  private key(instrumentId: string, timeframe: string): string {
    return `${instrumentId}:${timeframe}`;
  }

  /**
   * Apply a data_bar event. Creates a ring buffer for the
   * instrument/timeframe pair if one does not already exist.
   */
  applyBar(event: DataBarEvent): void {
    const k = this.key(event.instrumentId, event.timeframe);
    let buffer = this.buffers.get(k);
    if (!buffer) {
      buffer = new RingBuffer<DataBarEvent>(this.ringBufferSize);
      this.buffers.set(k, buffer);
    }
    buffer.push(event);
  }

  /**
   * Get bars for an instrument/timeframe in chronological order
   * (oldest first). Returns an empty array if no data has been
   * received for this combination.
   */
  getBars(instrumentId: string, timeframe: string): DataBarEvent[] {
    const buffer = this.buffers.get(this.key(instrumentId, timeframe));
    if (!buffer) {
      return [];
    }
    return buffer.toArray();
  }

  /**
   * Get the most recent bar for an instrument/timeframe, or
   * undefined if none have been received.
   */
  getLatestBar(
    instrumentId: string,
    timeframe: string,
  ): DataBarEvent | undefined {
    const buffer = this.buffers.get(this.key(instrumentId, timeframe));
    if (!buffer) {
      return undefined;
    }
    return buffer.latest;
  }

  /**
   * List all instrument/timeframe combinations currently being tracked.
   */
  getTrackedInstruments(): Array<{
    instrumentId: string;
    timeframe: string;
  }> {
    const result: Array<{ instrumentId: string; timeframe: string }> = [];
    for (const k of this.buffers.keys()) {
      const separatorIdx = k.indexOf(":");
      result.push({
        instrumentId: k.slice(0, separatorIdx),
        timeframe: k.slice(separatorIdx + 1),
      });
    }
    return result;
  }

  /**
   * Clear all cached data (e.g. on disconnect).
   */
  clear(): void {
    this.buffers.clear();
  }

  /**
   * Clear data for a specific subscription.
   */
  clearSubscription(instrumentId: string, timeframe: string): void {
    this.buffers.delete(this.key(instrumentId, timeframe));
  }
}
