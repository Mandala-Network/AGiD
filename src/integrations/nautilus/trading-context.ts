/**
 * Trading Context Builder
 *
 * Formats portfolio state, market data, risk engine state, and recent
 * trading activity into markdown tables injected into the LLM system
 * prompt each turn via the PromptBuilder context provider mechanism.
 *
 * This gives the LLM real-time awareness of trading state without
 * requiring explicit tool calls for read-only data.
 */

import type { BridgeClient } from "./bridge-client.js";
import type { ContextProvider } from "../../agent/prompt-builder.js";
import type { GepaOptimizer } from "../gepa/gepa-optimizer.js";
import { ConnectionState } from "./types.js";

interface RecentAction {
  time: number;
  action: string;
  details: string;
}

export interface TradingContextConfig {
  gepaOptimizer?: GepaOptimizer;
}

const DEFAULT_PREAMBLE =
  "Below is your real-time trading context from the NautilusBridge venue connection. " +
  "Use this data to inform all trading decisions. " +
  "Portfolio balances, open positions, and open orders reflect the current state on the venue. " +
  "Market data shows recent price bars for subscribed instruments. " +
  "Always check this context before submitting orders to avoid duplicate positions or exceeding risk limits. " +
  "When the bridge is disconnected, cached data may be stale -- note the bridge status before acting.";

export class TradingContextBuilder {
  private bridgeClient: BridgeClient;
  private gepaOptimizer?: GepaOptimizer;
  private recentActions: RecentAction[] = [];
  private readonly maxRecentActions = 5;
  private preamble: string = DEFAULT_PREAMBLE;

  constructor(bridgeClient: BridgeClient, config?: TradingContextConfig) {
    this.bridgeClient = bridgeClient;
    this.gepaOptimizer = config?.gepaOptimizer;
  }

  /**
   * Initialize the context builder. GEPA-optimizes the preamble instructions
   * that frame the trading context for the LLM. Call once after construction.
   */
  async initialize(): Promise<void> {
    if (this.gepaOptimizer) {
      this.preamble = await this.gepaOptimizer.optimizePromptComponent(
        DEFAULT_PREAMBLE,
        "TRADING_CONTEXT",
      );
    }
  }

  /**
   * Build the full trading context markdown string, or null if bridge is
   * disconnected and no cached portfolio data exists.
   */
  buildContext(): string | null {
    const state = this.bridgeClient.state;
    const hasPortfolioData =
      this.bridgeClient.portfolio.accounts.size > 0 ||
      this.bridgeClient.portfolio.positions.size > 0 ||
      this.bridgeClient.portfolio.orders.size > 0;

    // If disconnected and no cached data, return null
    if (state === ConnectionState.DISCONNECTED && !hasPortfolioData && this.recentActions.length === 0) {
      return null;
    }

    const sections: string[] = [];

    sections.push(this.buildBridgeStatus());
    sections.push(this.buildAccountBalances());
    sections.push(this.buildOpenPositions());
    sections.push(this.buildOpenOrders());
    sections.push(this.buildMarketData());
    sections.push(this.buildRecentActivity());

    return "[TRADING CONTEXT]\n" + this.preamble + "\n\n" + sections.join("\n\n") + "\n\n[END TRADING CONTEXT]";
  }

  /**
   * Record a trading action for the recent activity section.
   * Trims to maxRecentActions (last 5). Called by trading tools after
   * successful execution.
   */
  recordAction(action: string, details: string): void {
    this.recentActions.push({
      time: Date.now(),
      action,
      details,
    });

    // Trim to last N actions
    if (this.recentActions.length > this.maxRecentActions) {
      this.recentActions = this.recentActions.slice(-this.maxRecentActions);
    }
  }

  /**
   * Returns a ContextProvider function for registration with PromptBuilder.
   */
  toContextProvider(): ContextProvider {
    return () => this.buildContext();
  }

  // ---------------------------------------------------------------------------
  // Section builders
  // ---------------------------------------------------------------------------

  private buildBridgeStatus(): string {
    const state = this.bridgeClient.state;
    const lines: string[] = [];

    lines.push("## Bridge Status");
    lines.push("| Property | Value |");
    lines.push("|----------|-------|");
    lines.push(`| Connection | ${state} |`);

    // Risk engine state: derive from context. We cannot directly read
    // riskEngineState from the bridge (it comes via portfolio_response).
    // Use a simple heuristic: if connection is READY, show ACTIVE.
    // If disconnected, show UNKNOWN.
    let riskState = "UNKNOWN";
    if (state === ConnectionState.READY) {
      riskState = "ACTIVE";
    } else if (state === ConnectionState.DISCONNECTED) {
      riskState = "UNKNOWN";
    }

    lines.push(`| Risk Engine | ${riskState} |`);

    return lines.join("\n");
  }

  private buildAccountBalances(): string {
    const accounts = this.bridgeClient.portfolio.accounts;
    const lines: string[] = [];

    lines.push("## Account Balances");

    if (accounts.size === 0) {
      lines.push("No account data");
      return lines.join("\n");
    }

    lines.push("| Account | Currency | Total | Free | Locked |");
    lines.push("|---------|----------|-------|------|--------|");

    for (const [, acct] of accounts) {
      const accountId = acct.accountId ?? "N/A";
      const currency = (acct["currency"] as string | undefined) ?? "N/A";
      const total = (acct["balance"] as string | undefined) ?? (acct["total"] as string | undefined) ?? "N/A";
      const free = (acct["free"] as string | undefined) ?? "N/A";
      const locked = (acct["locked"] as string | undefined) ?? "N/A";
      lines.push(`| ${accountId} | ${currency} | ${total} | ${free} | ${locked} |`);
    }

    return lines.join("\n");
  }

  private buildOpenPositions(): string {
    const positions = this.bridgeClient.portfolio.positions;
    const lines: string[] = [];

    lines.push("## Open Positions");

    if (positions.size === 0) {
      lines.push("No open positions");
      return lines.join("\n");
    }

    lines.push("| Instrument | Side | Qty | Entry Price | Unrealized PnL |");
    lines.push("|------------|------|-----|-------------|----------------|");

    for (const [, pos] of positions) {
      lines.push(
        `| ${pos.instrumentId} | ${pos.side} | ${pos.quantity} | ${pos.entryPrice} | ${pos.unrealizedPnl} |`
      );
    }

    return lines.join("\n");
  }

  private buildOpenOrders(): string {
    const orders = this.bridgeClient.portfolio.orders;
    const lines: string[] = [];

    lines.push("## Open Orders");

    if (orders.size === 0) {
      lines.push("No open orders");
      return lines.join("\n");
    }

    lines.push("| ID | Instrument | Side | Type | Qty | Price | Status |");
    lines.push("|----|------------|------|------|-----|-------|--------|");

    for (const [, ord] of orders) {
      const price = ord.avgPrice ?? "N/A";
      lines.push(
        `| ${ord.clientOrderId} | ${ord.instrumentId} | ${ord.orderSide} | ${ord.orderType} | ${ord.quantity} | ${price} | ${ord.status} |`
      );
    }

    return lines.join("\n");
  }

  private buildMarketData(): string {
    const tracked = this.bridgeClient.marketData.getTrackedInstruments();
    const lines: string[] = [];

    lines.push("## Recent Market Data (Last 5 Bars)");

    if (tracked.length === 0) {
      lines.push("No market data subscriptions");
      return lines.join("\n");
    }

    for (const { instrumentId, timeframe } of tracked) {
      const bars = this.bridgeClient.marketData.getBars(instrumentId, timeframe);
      const recentBars = bars.slice(-5);

      lines.push(`### ${instrumentId} (${timeframe})`);
      lines.push("| Time | Open | High | Low | Close | Volume |");
      lines.push("|------|------|------|-----|-------|--------|");

      for (const bar of recentBars) {
        const time = this.formatTime(bar.tsEvent);
        lines.push(`| ${time} | ${bar.open} | ${bar.high} | ${bar.low} | ${bar.close} | ${bar.volume} |`);
      }
    }

    return lines.join("\n");
  }

  private buildRecentActivity(): string {
    const lines: string[] = [];

    lines.push("## Recent Activity (Last 5 Actions)");

    if (this.recentActions.length === 0) {
      lines.push("No recent trading activity");
      return lines.join("\n");
    }

    lines.push("| Time | Action | Details |");
    lines.push("|------|--------|---------|");

    for (const entry of this.recentActions) {
      const time = this.formatTime(entry.time);
      lines.push(`| ${time} | ${entry.action} | ${entry.details} |`);
    }

    return lines.join("\n");
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Format a timestamp (milliseconds or nanoseconds) as HH:MM.
   */
  private formatTime(ts: number): string {
    // Bridge timestamps are in nanoseconds (ts * 1_000_000), local are ms
    // If ts > 1e15, it is in nanoseconds; convert to ms
    const ms = ts > 1e15 ? Math.floor(ts / 1_000_000) : ts;
    const date = new Date(ms);
    const hours = date.getUTCHours().toString().padStart(2, "0");
    const minutes = date.getUTCMinutes().toString().padStart(2, "0");
    return `${hours}:${minutes}`;
  }
}
