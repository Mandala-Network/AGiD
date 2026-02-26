/**
 * Nautilus Trading Plugin
 *
 * Implements the AGiD ToolPlugin interface to expose 16 tools (10 trading +
 * 6 strategy) backed by the BridgeClient. Provides a setter for the current
 * turn's reasoning text so that submit_order and create_strategy can compute
 * reasoning hashes for on-chain storage.
 */

import type { ToolPlugin, ToolDescriptor, ToolContext } from "../../agent/tools/types.js";
import type { BridgeClient } from "./bridge-client.js";
import type { MemoryManager } from "../../storage/memory/memory-manager.js";
import { TradeMemoryRecorder } from "./trade-memory.js";
import { createTradingTools } from "./trading-tools.js";
import { createStrategyTools } from "./strategy-tools.js";
import { StrategyContextBuilder } from "./strategy-context.js";

// ---------------------------------------------------------------------------
// NautilusTradingPlugin
// ---------------------------------------------------------------------------

export class NautilusTradingPlugin implements ToolPlugin {
  readonly name = "nautilus-trading";
  readonly version = "0.2.0";
  readonly description = "NautilusTrader bridge for algorithmic trading and strategy management";

  private readonly _bridgeClient: BridgeClient;
  private _currentReasoningText: string | null = null;
  private readonly _tradeMemoryRecorder: TradeMemoryRecorder | null;
  private readonly _strategyContextBuilder: StrategyContextBuilder;

  constructor(bridgeClient: BridgeClient, memoryManager?: MemoryManager) {
    this._bridgeClient = bridgeClient;
    this._tradeMemoryRecorder = memoryManager
      ? new TradeMemoryRecorder(memoryManager)
      : null;
    this._strategyContextBuilder = new StrategyContextBuilder(bridgeClient);
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
   * Expose the StrategyContextBuilder so the gateway startup can register
   * it as a ContextProvider on PromptBuilder (same pattern as
   * TradingContextBuilder).
   */
  get strategyContextBuilder(): StrategyContextBuilder {
    return this._strategyContextBuilder;
  }

  /**
   * Create 16 tool descriptors backed by the BridgeClient:
   * - 10 trading tools (orders, portfolio, market data, etc.)
   * - 6 strategy tools (create, backtest, optimize, deploy, monitor, pause)
   *
   * Prefers MemoryManager from ToolContext (injected by gateway) over the
   * constructor arg, since the gateway creates MemoryManager after plugins.
   */
  createTools(ctx: ToolContext): ToolDescriptor[] {
    // Lazily create recorder from ctx.memoryManager if constructor didn't get one
    if (!this._tradeMemoryRecorder && ctx.memoryManager) {
      (this as any)._tradeMemoryRecorder = new TradeMemoryRecorder(ctx.memoryManager);
    }

    const getReasoningText = () => {
      // Return the current reasoning text and clear it after read
      const text = this._currentReasoningText;
      this._currentReasoningText = null;
      return text;
    };

    const tradingTools = createTradingTools(
      this._bridgeClient,
      getReasoningText,
      this._tradeMemoryRecorder ?? undefined,
    );

    const strategyTools = createStrategyTools(
      this._bridgeClient,
      getReasoningText,
      this._tradeMemoryRecorder ?? undefined,
      this._strategyContextBuilder,
    );

    return [...tradingTools, ...strategyTools];
  }
}
