/**
 * Nautilus Trading Plugin
 *
 * Implements the AGiD ToolPlugin interface to expose 10 trading tools
 * backed by the BridgeClient. Provides a setter for the current turn's
 * reasoning text so that submit_order can compute reasoning hashes.
 */

import type { ToolPlugin, ToolDescriptor, ToolContext } from "../../agent/tools/types.js";
import type { BridgeClient } from "./bridge-client.js";
import type { MemoryManager } from "../../storage/memory/memory-manager.js";
import { TradeMemoryRecorder } from "./trade-memory.js";
import { createTradingTools } from "./trading-tools.js";

// ---------------------------------------------------------------------------
// NautilusTradingPlugin
// ---------------------------------------------------------------------------

export class NautilusTradingPlugin implements ToolPlugin {
  readonly name = "nautilus-trading";
  readonly version = "0.1.0";
  readonly description = "NautilusTrader bridge for algorithmic trading";

  private readonly _bridgeClient: BridgeClient;
  private _currentReasoningText: string | null = null;
  private readonly _tradeMemoryRecorder: TradeMemoryRecorder | null;

  constructor(bridgeClient: BridgeClient, memoryManager?: MemoryManager) {
    this._bridgeClient = bridgeClient;
    this._tradeMemoryRecorder = memoryManager
      ? new TradeMemoryRecorder(memoryManager)
      : null;
  }

  /**
   * Set the current turn's assistant reasoning text. The AgentLoop (or
   * gateway wrapper) calls this before tool execution with `response.text`.
   * Pass null to clear after execution.
   */
  setCurrentReasoningText(text: string | null): void {
    this._currentReasoningText = text;
  }

  /**
   * Expose the TradeMemoryRecorder so Plan 03's audit trail can also record
   * fill/close events from BridgeClient event callbacks.
   */
  get tradeMemoryRecorder(): TradeMemoryRecorder | null {
    return this._tradeMemoryRecorder;
  }

  /**
   * Create 10 trading tool descriptors backed by the BridgeClient.
   */
  createTools(_ctx: ToolContext): ToolDescriptor[] {
    return createTradingTools(
      this._bridgeClient,
      () => {
        // Return the current reasoning text and clear it after read
        const text = this._currentReasoningText;
        this._currentReasoningText = null;
        return text;
      },
      this._tradeMemoryRecorder ?? undefined,
    );
  }
}
