/**
 * Strategy Context Builder
 *
 * Formats active strategy states, performance metrics, degradation alerts,
 * and available strategy actions into markdown tables injected into the LLM
 * system prompt each turn via the PromptBuilder context provider mechanism.
 *
 * Follows the same ContextProvider pattern as TradingContextBuilder:
 * - Returns null if bridge is not READY
 * - Wraps content in [STRATEGY CONTEXT] / [END STRATEGY CONTEXT] markers
 * - Maintains an in-memory cache of strategy states updated by strategy tools
 *
 * The strategy context gives the LLM real-time awareness of strategy status,
 * key metrics, and live vs backtest comparison without requiring explicit
 * tool calls for read-only data.
 */

import type { BridgeClient } from "./bridge-client.js";
import type { ContextProvider } from "../../agent/prompt-builder.js";
import { ConnectionState } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BacktestMetrics {
  sharpe?: number;
  sortino?: number;
  maxDrawdownPct?: number;
  winRate?: number;
  totalPnl?: string;
  tradeCount?: number;
  profitFactor?: number;
}

export interface LiveMetrics {
  totalPnl?: string;
  tradeCount?: number;
  winRate?: number;
  maxDrawdown?: number;
  currentEquity?: string;
}

export interface DegradationInfo {
  severity: "warning" | "critical";
  reasons: string[];
  recommendedAction: string;
}

export interface StrategyState {
  id: string;
  name: string;
  status: "created" | "backtested" | "optimized" | "deployed" | "paused" | "unknown";
  instruments: string[];
  backtestMetrics?: BacktestMetrics;
  liveMetrics?: LiveMetrics;
  degradation?: DegradationInfo;
}

// ---------------------------------------------------------------------------
// Cache entry with TTL
// ---------------------------------------------------------------------------

interface CacheEntry {
  state: StrategyState;
  updatedAt: number;
}

const CACHE_TTL_MS = 30_000; // 30-second TTL matching plan spec

// ---------------------------------------------------------------------------
// StrategyContextBuilder
// ---------------------------------------------------------------------------

export class StrategyContextBuilder {
  private readonly _bridgeClient: BridgeClient;
  private readonly _strategyStates: Map<string, CacheEntry> = new Map();

  constructor(bridgeClient: BridgeClient) {
    this._bridgeClient = bridgeClient;
  }

  /**
   * Update strategy state after a tool operation completes.
   * Called by strategy tools after create/backtest/deploy/monitor/pause.
   */
  updateStrategyState(id: string, state: StrategyState): void {
    this._strategyStates.set(id, {
      state,
      updatedAt: Date.now(),
    });
  }

  /**
   * Get the current state for a strategy, or undefined if not tracked.
   */
  getStrategyState(id: string): StrategyState | undefined {
    const entry = this._strategyStates.get(id);
    if (!entry) return undefined;
    return entry.state;
  }

  /**
   * Get all tracked strategy IDs.
   */
  getTrackedStrategyIds(): string[] {
    return Array.from(this._strategyStates.keys());
  }

  /**
   * Returns a ContextProvider function for registration with PromptBuilder.
   * Same pattern as TradingContextBuilder.toContextProvider().
   */
  getContextProvider(): ContextProvider {
    return () => this.buildContext();
  }

  /**
   * Build the full strategy context markdown string, or null if bridge is
   * not READY or no strategy data exists.
   */
  buildContext(): string | null {
    // Return null if bridge is not READY
    if (this._bridgeClient.state !== ConnectionState.READY) {
      return null;
    }

    // Return null if no strategies tracked
    if (this._strategyStates.size === 0) {
      return null;
    }

    // Evict stale entries beyond TTL
    this.evictStaleEntries();

    // If all entries were evicted, return null
    if (this._strategyStates.size === 0) {
      return null;
    }

    const sections: string[] = [];

    sections.push(this.buildActiveStrategiesSummary());
    sections.push(this.buildDegradationAlerts());
    sections.push(this.buildAvailableActions());

    return "[STRATEGY CONTEXT]\n" + sections.join("\n\n") + "\n\n[END STRATEGY CONTEXT]";
  }

  // ---------------------------------------------------------------------------
  // Section builders
  // ---------------------------------------------------------------------------

  private buildActiveStrategiesSummary(): string {
    const lines: string[] = [];

    lines.push("## Active Strategies Summary");
    lines.push("");
    lines.push("| Strategy | Status | Instruments | Sharpe (BT) | Max DD (BT) | Live PnL | Live Trades |");
    lines.push("|----------|--------|-------------|-------------|-------------|----------|-------------|");

    for (const [, entry] of this._strategyStates) {
      const s = entry.state;

      // Show strategies that are in backtested, optimized, deployed, or paused status
      if (s.status === "created") continue;

      const instruments = s.instruments.join(", ");
      const btSharpe = s.backtestMetrics?.sharpe !== undefined
        ? s.backtestMetrics.sharpe.toFixed(2)
        : "N/A";
      const btMaxDD = s.backtestMetrics?.maxDrawdownPct !== undefined
        ? `${(s.backtestMetrics.maxDrawdownPct * 100).toFixed(1)}%`
        : "N/A";

      // Live metrics only for deployed strategies
      let livePnl = "N/A";
      let liveTrades = "N/A";
      if (s.status === "deployed" && s.liveMetrics) {
        livePnl = s.liveMetrics.totalPnl ?? "N/A";
        liveTrades = s.liveMetrics.tradeCount !== undefined
          ? String(s.liveMetrics.tradeCount)
          : "N/A";
      }

      lines.push(
        `| ${s.name} | ${s.status} | ${instruments} | ${btSharpe} | ${btMaxDD} | ${livePnl} | ${liveTrades} |`,
      );
    }

    return lines.join("\n");
  }

  private buildDegradationAlerts(): string {
    const lines: string[] = [];

    lines.push("## Degradation Alerts");

    let hasAlerts = false;
    for (const [, entry] of this._strategyStates) {
      const s = entry.state;
      if (s.degradation && s.status === "deployed") {
        hasAlerts = true;
        const severity = s.degradation.severity === "critical" ? "CRITICAL" : "WARNING";
        for (const reason of s.degradation.reasons) {
          lines.push(`${severity}: ${s.name} -- ${reason}`);
        }
      }
    }

    if (!hasAlerts) {
      lines.push("No degradation alerts.");
    }

    return lines.join("\n");
  }

  private buildAvailableActions(): string {
    const lines: string[] = [];

    lines.push("## Available Strategy Actions");
    lines.push("- `nautilus_create_strategy` -- Generate a new strategy from description");
    lines.push("- `nautilus_backtest_strategy` -- Run backtest against historical data");
    lines.push("- `nautilus_optimize_strategy` -- Optimize parameters with grid/random search");
    lines.push("- `nautilus_deploy_strategy` -- Deploy to live or paper trading");
    lines.push("- `nautilus_monitor_strategy` -- Check live performance vs backtest");
    lines.push("- `nautilus_pause_strategy` -- Pause a running strategy");

    return lines.join("\n");
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private evictStaleEntries(): void {
    const now = Date.now();
    for (const [id, entry] of this._strategyStates) {
      if (now - entry.updatedAt > CACHE_TTL_MS) {
        this._strategyStates.delete(id);
      }
    }
  }
}
