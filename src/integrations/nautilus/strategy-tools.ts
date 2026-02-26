/**
 * Strategy Tools
 *
 * Creates 6 strategy tool descriptors for the AGiD agent to interact with
 * NautilusTrader strategy generation, backtesting, and optimization via
 * the BridgeClient. Each tool produces formatted markdown responses
 * (not raw JSON) and checks bridge connectivity before execution.
 *
 * Tools:
 *   1. nautilus_create_strategy    4. nautilus_deploy_strategy
 *   2. nautilus_backtest_strategy  5. nautilus_monitor_strategy
 *   3. nautilus_optimize_strategy  6. nautilus_pause_strategy
 */

import type { ToolDescriptor, ToolContext } from "../../agent/tools/types.js";
import type { ToolResult } from "../../types/agent-types.js";
import type { BridgeClient } from "./bridge-client.js";
import type { TradeMemoryRecorder } from "./trade-memory.js";
import type {
  CreateStrategyResponse,
  BacktestResult,
  OptimizeResult,
  DeployResult,
  MonitorResult,
  PauseResult,
} from "./types.js";
import { ConnectionState } from "./types.js";
import { computeReasoningHash } from "./reasoning-hash.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ToolExecuteFn = (
  params: Record<string, unknown>,
  ctx: ToolContext,
) => Promise<ToolResult>;

// ---------------------------------------------------------------------------
// Bridge state guard (same pattern as trading-tools.ts)
// ---------------------------------------------------------------------------

function checkBridgeState(client: BridgeClient): ToolResult | null {
  if (client.state !== ConnectionState.READY) {
    return {
      content: "Bridge disconnected. Strategy operations unavailable.",
      isError: true,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create 6 strategy tool descriptors that delegate to BridgeClient commands.
 *
 * @param bridgeClient - The BridgeClient instance for bridge communication
 * @param getReasoningText - Closure returning the current turn's assistant text (or null)
 * @param tradeMemoryRecorder - Optional recorder for on-chain trade event storage
 * @returns Array of 6 ToolDescriptor objects
 */
export function createStrategyTools(
  bridgeClient: BridgeClient,
  getReasoningText?: () => string | null,
  tradeMemoryRecorder?: TradeMemoryRecorder,
): ToolDescriptor[] {
  return [
    // 1. Create Strategy
    createCreateStrategy(bridgeClient, getReasoningText, tradeMemoryRecorder),
    // 2. Backtest Strategy
    createBacktestStrategy(bridgeClient),
    // 3. Optimize Strategy
    createOptimizeStrategy(bridgeClient),
    // 4. Deploy Strategy
    createDeployStrategy(bridgeClient),
    // 5. Monitor Strategy
    createMonitorStrategy(bridgeClient),
    // 6. Pause Strategy
    createPauseStrategy(bridgeClient),
  ];
}

// ---------------------------------------------------------------------------
// 1. Create Strategy
// ---------------------------------------------------------------------------

function createCreateStrategy(
  client: BridgeClient,
  getReasoningText?: () => string | null,
  recorder?: TradeMemoryRecorder,
): ToolDescriptor {
  const execute: ToolExecuteFn = async (params) => {
    const guard = checkBridgeState(client);
    if (guard) return guard;

    try {
      const description = params.description as string;
      const instruments = params.instruments as string[];
      const barType = params.barType as string;
      const indicators = params.indicators as Array<{ name: string; params: Record<string, unknown> }>;
      const entryLogic = params.entryLogic as string;
      const exitLogic = params.exitLogic as string;
      const tradeSize = params.tradeSize as string;
      const riskParams = params.riskParams as {
        stopLossPct: number;
        takeProfitPct: number;
        maxPositionSize: string;
      };

      // Compute reasoning hash if reasoning text is available
      let reasoningHash: string | undefined;
      const reasoningText = getReasoningText?.() ?? null;
      if (reasoningText) {
        reasoningHash = await computeReasoningHash(reasoningText, params);
      }

      const result = await client.sendCommand<CreateStrategyResponse>(
        "create_strategy",
        {
          description,
          instruments,
          barType,
          indicators,
          entryLogic,
          exitLogic,
          tradeSize,
          riskParams,
        },
      );

      // Fire-and-forget strategy creation memory recording
      recorder?.recordTrade({
        eventType: "trade_submitted",
        instrument: instruments[0] ?? "STRATEGY",
        side: "BUY",
        quantity: "0",
        orderId: result.strategyId,
        reasoningHash,
        timestamp: Date.now(),
      }).catch((err) => console.warn("Trade memory storage failed:", err));

      // Format code preview (first 20 lines)
      const codeLines = (result.code ?? "").split("\n");
      const preview = codeLines.slice(0, 20).join("\n");
      const truncated = codeLines.length > 20
        ? `\n... (${codeLines.length - 20} more lines)`
        : "";

      let md = `## Strategy Created\n\n`;
      md += `| Property | Value |\n`;
      md += `|----------|-------|\n`;
      md += `| Strategy ID | ${result.strategyId} |\n`;
      md += `| File Path | ${result.filePath} |\n`;
      md += `| Instruments | ${instruments.join(", ")} |\n`;
      md += `| Bar Type | ${barType} |\n`;
      md += `| Indicators | ${indicators.map(i => i.name).join(", ")} |\n\n`;
      md += `### Code Preview\n\n`;
      md += `\`\`\`python\n${preview}${truncated}\n\`\`\``;

      return { content: md };
    } catch (err) {
      return {
        content: `Strategy creation failed: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }
  };

  return {
    definition: {
      name: "nautilus_create_strategy",
      description:
        "Generate a new NautilusTrader trading strategy from a natural language description and structured parameters. Returns the strategy ID, file path, and code preview.",
      input_schema: {
        type: "object",
        properties: {
          description: { type: "string", description: "Natural language description of the strategy" },
          instruments: {
            type: "array",
            items: { type: "string" },
            description: "List of instrument symbols (e.g. ['AAPL.XNAS'])",
          },
          barType: { type: "string", description: "Bar type string (e.g. 'AAPL.XNAS-1-MINUTE-LAST-EXTERNAL')" },
          indicators: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string", description: "Indicator class name (e.g. ExponentialMovingAverage)" },
                params: { type: "object", description: "Indicator constructor parameters" },
              },
              required: ["name", "params"],
            },
            description: "List of indicators with their parameters",
          },
          entryLogic: { type: "string", description: "Python expression for entry condition" },
          exitLogic: { type: "string", description: "Python expression for exit condition" },
          tradeSize: { type: "string", description: "Trade size as decimal string" },
          riskParams: {
            type: "object",
            properties: {
              stopLossPct: { type: "number", description: "Stop loss percentage (e.g. 0.02 for 2%)" },
              takeProfitPct: { type: "number", description: "Take profit percentage (e.g. 0.05 for 5%)" },
              maxPositionSize: { type: "string", description: "Maximum position size as decimal string" },
            },
            required: ["stopLossPct", "takeProfitPct", "maxPositionSize"],
            description: "Risk management parameters",
          },
        },
        required: [
          "description",
          "instruments",
          "barType",
          "indicators",
          "entryLogic",
          "exitLogic",
          "tradeSize",
          "riskParams",
        ],
      },
    },
    execute,
    requiresWallet: false,
  };
}

// ---------------------------------------------------------------------------
// 2. Backtest Strategy
// ---------------------------------------------------------------------------

function createBacktestStrategy(client: BridgeClient): ToolDescriptor {
  const execute: ToolExecuteFn = async (params) => {
    const guard = checkBridgeState(client);
    if (guard) return guard;

    try {
      const strategyId = params.strategyId as string;
      const catalogPath = params.catalogPath as string;
      const startTime = params.startTime as string;
      const endTime = params.endTime as string;
      const venue = (params.venue as string) ?? "SIM";
      const startingBalance = (params.startingBalance as string) ?? "100000";
      const currency = (params.currency as string) ?? "USD";

      const result = await client.sendCommand<BacktestResult>(
        "backtest_strategy",
        {
          strategyId,
          catalogPath,
          startTime,
          endTime,
          venue,
          startingBalance,
          currency,
        },
      );

      const m = result.metrics as Record<string, unknown>;

      // Format metrics table
      let md = `## Backtest Results: ${result.strategyId}\n\n`;
      md += `| Metric | Value |\n`;
      md += `|--------|-------|\n`;
      md += `| Sharpe Ratio | ${formatNum(m.sharpe)} |\n`;
      md += `| Sortino Ratio | ${formatNum(m.sortino)} |\n`;
      md += `| Max Drawdown | ${formatNum(m.maxDrawdown)} |\n`;
      md += `| Max Drawdown % | ${formatPct(m.maxDrawdownPct)} |\n`;
      md += `| Win Rate | ${formatPct(m.winRate)} |\n`;
      md += `| Total PnL | ${m.totalPnl ?? "N/A"} |\n`;
      md += `| Total Return | ${formatPct(m.totalReturn)} |\n`;
      md += `| Trade Count | ${m.tradeCount ?? 0} |\n`;
      md += `| Avg Win | ${m.avgWin ?? "N/A"} |\n`;
      md += `| Avg Loss | ${m.avgLoss ?? "N/A"} |\n`;
      md += `| Profit Factor | ${formatNum(m.profitFactor)} |\n`;
      md += `| Total Orders | ${result.totalOrders} |\n`;
      md += `| Total Positions | ${result.totalPositions} |\n`;
      md += `| Elapsed Time | ${result.elapsedTime.toFixed(2)}s |\n\n`;

      // ASCII equity curve summary
      if (result.equityCurve && result.equityCurve.length > 0) {
        md += `### Equity Curve (${result.equityCurve.length} points)\n\n`;
        const equities = result.equityCurve.map(p => p.equity);
        const minEq = Math.min(...equities);
        const maxEq = Math.max(...equities);
        const startEq = equities[0] ?? 0;
        const endEq = equities[equities.length - 1] ?? 0;
        md += `Start: ${startEq.toFixed(2)} | End: ${endEq.toFixed(2)} | `;
        md += `Min: ${minEq.toFixed(2)} | Max: ${maxEq.toFixed(2)}\n`;
      }

      return { content: md.trim() };
    } catch (err) {
      return {
        content: `Backtest failed: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }
  };

  return {
    definition: {
      name: "nautilus_backtest_strategy",
      description:
        "Run a backtest on a previously generated strategy against historical data. Returns structured performance metrics including Sharpe ratio, drawdown, win rate, and equity curve summary.",
      input_schema: {
        type: "object",
        properties: {
          strategyId: { type: "string", description: "Strategy ID returned from create_strategy" },
          catalogPath: { type: "string", description: "Path to the Parquet data catalog" },
          startTime: { type: "string", description: "Backtest start time (ISO 8601)" },
          endTime: { type: "string", description: "Backtest end time (ISO 8601)" },
          venue: { type: "string", description: "Venue name (default: SIM)" },
          startingBalance: { type: "string", description: "Starting balance as decimal string (default: 100000)" },
          currency: { type: "string", description: "Account currency (default: USD)" },
        },
        required: ["strategyId", "catalogPath", "startTime", "endTime"],
      },
    },
    execute,
    requiresWallet: false,
  };
}

// ---------------------------------------------------------------------------
// 3. Optimize Strategy
// ---------------------------------------------------------------------------

function createOptimizeStrategy(client: BridgeClient): ToolDescriptor {
  const execute: ToolExecuteFn = async (params) => {
    const guard = checkBridgeState(client);
    if (guard) return guard;

    try {
      const strategyId = params.strategyId as string;
      const paramRanges = params.paramRanges as Record<string, unknown[]>;
      const searchType = (params.searchType as string) ?? "grid";
      const maxIterations = (params.maxIterations as number) ?? 100;
      const catalogPath = params.catalogPath as string;
      const startTime = params.startTime as string;
      const endTime = params.endTime as string;

      const result = await client.sendCommand<OptimizeResult>(
        "optimize_strategy",
        {
          strategyId,
          paramRanges,
          searchType,
          maxIterations,
          catalogPath,
          startTime,
          endTime,
        },
      );

      // Format results
      let md = `## Optimization Results: ${result.strategyId}\n\n`;

      // Best parameters
      md += `### Best Parameters\n\n`;
      md += `| Parameter | Value |\n`;
      md += `|-----------|-------|\n`;
      for (const [key, value] of Object.entries(result.bestParams)) {
        md += `| ${key} | ${String(value)} |\n`;
      }
      md += `\n`;

      // Best metrics
      const bm = result.bestMetrics;
      md += `### Best Metrics\n\n`;
      md += `| Metric | Value |\n`;
      md += `|--------|-------|\n`;
      md += `| Sharpe | ${formatNum(bm.sharpe)} |\n`;
      md += `| Win Rate | ${formatPct(bm.winRate)} |\n`;
      md += `| Total PnL | ${bm.totalPnl ?? "N/A"} |\n`;
      md += `| Profit Factor | ${formatNum(bm.profitFactor)} |\n\n`;

      // Top 10 results table
      const topResults = result.allResults.slice(0, 10);
      if (topResults.length > 0) {
        md += `### Top ${topResults.length} Results\n\n`;
        md += `| # | Params | IS Sharpe | OOS Sharpe | Overfit? |\n`;
        md += `|---|--------|-----------|------------|----------|\n`;
        for (let i = 0; i < topResults.length; i++) {
          const r = topResults[i] as Record<string, unknown>;
          const rParams = r.params as Record<string, unknown> | undefined;
          const inSample = r.in_sample as Record<string, unknown> | undefined;
          const outOfSample = r.out_of_sample as Record<string, unknown> | undefined;
          const overfitFlag = r.overfit_flag as boolean | undefined;

          const paramStr = rParams
            ? Object.entries(rParams).map(([k, v]) => `${k}=${String(v)}`).join(", ")
            : "N/A";
          const isSharpe = formatNum(inSample?.sharpe);
          const oosSharpe = formatNum(outOfSample?.sharpe);
          const overfit = overfitFlag ? "WARNING" : "OK";

          md += `| ${i + 1} | ${paramStr} | ${isSharpe} | ${oosSharpe} | ${overfit} |\n`;
        }
      }

      return { content: md.trim() };
    } catch (err) {
      return {
        content: `Optimization failed: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }
  };

  return {
    definition: {
      name: "nautilus_optimize_strategy",
      description:
        "Run parameter optimization on a strategy using grid or random search. Tests parameter combinations across in-sample and out-of-sample periods to detect overfitting. Returns ranked results with overfit warnings.",
      input_schema: {
        type: "object",
        properties: {
          strategyId: { type: "string", description: "Strategy ID to optimize" },
          paramRanges: {
            type: "object",
            description: "Parameter names mapped to arrays of values to try (e.g. {fast_period: [5, 10, 15]})",
          },
          searchType: { type: "string", description: "Search type: 'grid' or 'random' (default: grid)" },
          maxIterations: { type: "number", description: "Maximum iterations for random search (default: 100)" },
          catalogPath: { type: "string", description: "Path to the Parquet data catalog" },
          startTime: { type: "string", description: "Optimization period start (ISO 8601)" },
          endTime: { type: "string", description: "Optimization period end (ISO 8601)" },
        },
        required: ["strategyId", "paramRanges", "catalogPath", "startTime", "endTime"],
      },
    },
    execute,
    requiresWallet: false,
  };
}

// ---------------------------------------------------------------------------
// 4. Deploy Strategy
// ---------------------------------------------------------------------------

function createDeployStrategy(client: BridgeClient): ToolDescriptor {
  const execute: ToolExecuteFn = async (params) => {
    const guard = checkBridgeState(client);
    if (guard) return guard;

    try {
      const strategyId = params.strategyId as string;
      const mode = params.mode as string;
      const thresholds = params.thresholds as {
        minSharpe?: number;
        maxDrawdown?: number;
        minTradeCount?: number;
      } | undefined;

      const cmdParams: Record<string, unknown> = {
        strategyId,
        mode,
      };
      if (thresholds !== undefined) {
        cmdParams.thresholds = thresholds;
      }

      const result = await client.sendCommand<DeployResult>(
        "deploy_strategy",
        cmdParams,
      );

      let md = `## Strategy Deployed\n\n`;
      md += `| Property | Value |\n`;
      md += `|----------|-------|\n`;
      md += `| Strategy ID | ${result.strategyId} |\n`;
      md += `| Deployment ID | ${result.deploymentId} |\n`;
      md += `| Status | ${result.status} |\n`;
      md += `| Mode | ${result.mode} |\n`;

      return { content: md.trim() };
    } catch (err) {
      return {
        content: `Deploy failed: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }
  };

  return {
    definition: {
      name: "nautilus_deploy_strategy",
      description:
        "Deploy a strategy to live or paper trading. Optionally specify minimum performance thresholds that must be met before deployment.",
      input_schema: {
        type: "object",
        properties: {
          strategyId: { type: "string", description: "Strategy ID to deploy" },
          mode: { type: "string", description: "'live' or 'paper'" },
          thresholds: {
            type: "object",
            properties: {
              minSharpe: { type: "number", description: "Minimum Sharpe ratio required" },
              maxDrawdown: { type: "number", description: "Maximum acceptable drawdown" },
              minTradeCount: { type: "number", description: "Minimum number of trades in backtest" },
            },
            description: "Optional performance thresholds for deployment gate",
          },
        },
        required: ["strategyId", "mode"],
      },
    },
    execute,
    requiresWallet: false,
  };
}

// ---------------------------------------------------------------------------
// 5. Monitor Strategy
// ---------------------------------------------------------------------------

function createMonitorStrategy(client: BridgeClient): ToolDescriptor {
  const execute: ToolExecuteFn = async (params) => {
    const guard = checkBridgeState(client);
    if (guard) return guard;

    try {
      const strategyId = params.strategyId as string;

      const result = await client.sendCommand<MonitorResult>(
        "monitor_strategy",
        { strategyId },
      );

      let md = `## Strategy Monitor: ${result.strategyId}\n\n`;
      md += `**Status:** ${result.status}\n\n`;

      // Live vs backtest metrics comparison
      const live = result.liveMetrics as Record<string, unknown>;
      const bt = result.backtestMetrics as Record<string, unknown>;

      md += `### Performance Comparison\n\n`;
      md += `| Metric | Live | Backtest | Delta |\n`;
      md += `|--------|------|----------|-------|\n`;

      const metricKeys = ["sharpe", "winRate", "totalPnl", "maxDrawdownPct", "profitFactor"];
      for (const key of metricKeys) {
        const liveVal = live[key];
        const btVal = bt[key];
        const liveStr = liveVal !== undefined ? String(liveVal) : "N/A";
        const btStr = btVal !== undefined ? String(btVal) : "N/A";
        const delta = (typeof liveVal === "number" && typeof btVal === "number")
          ? (liveVal - btVal).toFixed(4)
          : "N/A";
        md += `| ${key} | ${liveStr} | ${btStr} | ${delta} |\n`;
      }
      md += `\n`;

      // Degradation info
      if (result.degradation) {
        const deg = result.degradation;
        md += `### Degradation Alert\n\n`;
        for (const [key, value] of Object.entries(deg)) {
          md += `- **${key}:** ${String(value)}\n`;
        }
      } else {
        md += `No performance degradation detected.\n`;
      }

      return { content: md.trim() };
    } catch (err) {
      return {
        content: `Monitor failed: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }
  };

  return {
    definition: {
      name: "nautilus_monitor_strategy",
      description:
        "Monitor a deployed strategy's live performance. Compares live metrics against backtest results and reports any performance degradation.",
      input_schema: {
        type: "object",
        properties: {
          strategyId: { type: "string", description: "Strategy ID to monitor" },
        },
        required: ["strategyId"],
      },
    },
    execute,
    requiresWallet: false,
  };
}

// ---------------------------------------------------------------------------
// 6. Pause Strategy
// ---------------------------------------------------------------------------

function createPauseStrategy(client: BridgeClient): ToolDescriptor {
  const execute: ToolExecuteFn = async (params) => {
    const guard = checkBridgeState(client);
    if (guard) return guard;

    try {
      const strategyId = params.strategyId as string;

      const result = await client.sendCommand<PauseResult>(
        "pause_strategy",
        { strategyId },
      );

      return {
        content: `Strategy PAUSED: ${result.strategyId} (status: ${result.status})`,
      };
    } catch (err) {
      return {
        content: `Pause failed: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }
  };

  return {
    definition: {
      name: "nautilus_pause_strategy",
      description:
        "Pause a running strategy. Stops new order submissions while keeping existing positions open.",
      input_schema: {
        type: "object",
        properties: {
          strategyId: { type: "string", description: "Strategy ID to pause" },
        },
        required: ["strategyId"],
      },
    },
    execute,
    requiresWallet: false,
  };
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatNum(value: unknown): string {
  if (typeof value === "number") {
    return value.toFixed(4);
  }
  return String(value ?? "N/A");
}

function formatPct(value: unknown): string {
  if (typeof value === "number") {
    return `${(value * 100).toFixed(2)}%`;
  }
  return String(value ?? "N/A");
}
