/**
 * Unit tests for TradingContextBuilder and PromptBuilder context provider extension.
 *
 * Uses mock BridgeClient with configurable state, portfolio, and market data.
 * Tests cover: PromptBuilder extension, bridge status, portfolio sections,
 * market data, recent activity, and full context assembly.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { TradingContextBuilder } from "../trading-context.js";
import { PromptBuilder } from "../../../agent/prompt-builder.js";
import type { ContextProvider } from "../../../agent/prompt-builder.js";
import { ConnectionState } from "../types.js";
import type { AccountState, PositionState, OrderState } from "../portfolio-cache.js";
import type { DataBarEvent } from "../types.js";

// ---------------------------------------------------------------------------
// Mock BridgeClient
// ---------------------------------------------------------------------------

class MockBridgeClient {
  private _state: ConnectionState;
  private _accounts: Map<string, AccountState>;
  private _positions: Map<string, PositionState>;
  private _orders: Map<string, OrderState>;
  private _bars: Map<string, DataBarEvent[]>;
  private _trackedInstruments: Array<{ instrumentId: string; timeframe: string }>;

  constructor(options?: {
    state?: ConnectionState;
    accounts?: Map<string, AccountState>;
    positions?: Map<string, PositionState>;
    orders?: Map<string, OrderState>;
    bars?: Map<string, DataBarEvent[]>;
    trackedInstruments?: Array<{ instrumentId: string; timeframe: string }>;
  }) {
    this._state = options?.state ?? ConnectionState.READY;
    this._accounts = options?.accounts ?? new Map();
    this._positions = options?.positions ?? new Map();
    this._orders = options?.orders ?? new Map();
    this._bars = options?.bars ?? new Map();
    this._trackedInstruments = options?.trackedInstruments ?? [];
  }

  get state(): ConnectionState {
    return this._state;
  }

  set state(s: ConnectionState) {
    this._state = s;
  }

  get portfolio(): {
    readonly accounts: ReadonlyMap<string, AccountState>;
    readonly positions: ReadonlyMap<string, PositionState>;
    readonly orders: ReadonlyMap<string, OrderState>;
  } {
    return {
      accounts: this._accounts,
      positions: this._positions,
      orders: this._orders,
    };
  }

  get marketData(): {
    getBars(instrumentId: string, timeframe: string): DataBarEvent[];
    getLatestBar(instrumentId: string, timeframe: string): DataBarEvent | undefined;
    getTrackedInstruments(): Array<{ instrumentId: string; timeframe: string }>;
  } {
    return {
      getBars: (instrumentId: string, timeframe: string) => {
        const key = `${instrumentId}:${timeframe}`;
        return this._bars.get(key) ?? [];
      },
      getLatestBar: (instrumentId: string, timeframe: string) => {
        const key = `${instrumentId}:${timeframe}`;
        const bars = this._bars.get(key);
        if (!bars || bars.length === 0) return undefined;
        return bars[bars.length - 1];
      },
      getTrackedInstruments: () => {
        return this._trackedInstruments;
      },
    };
  }

  // Helper to set accounts for tests
  setAccounts(accounts: AccountState[]): void {
    this._accounts.clear();
    for (const a of accounts) {
      this._accounts.set(a.accountId, a);
    }
  }

  // Helper to set positions for tests
  setPositions(positions: PositionState[]): void {
    this._positions.clear();
    for (const p of positions) {
      this._positions.set(p.positionId, p);
    }
  }

  // Helper to set orders for tests
  setOrders(orders: OrderState[]): void {
    this._orders.clear();
    for (const o of orders) {
      this._orders.set(o.clientOrderId, o);
    }
  }

  // Helper to set bars for tests
  setBars(instrumentId: string, timeframe: string, bars: DataBarEvent[]): void {
    const key = `${instrumentId}:${timeframe}`;
    this._bars.set(key, bars);
    // Ensure tracked instruments includes this pair
    const exists = this._trackedInstruments.some(
      (t) => t.instrumentId === instrumentId && t.timeframe === timeframe
    );
    if (!exists) {
      this._trackedInstruments.push({ instrumentId, timeframe });
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockBar(
  instrumentId: string,
  timeframe: string,
  overrides?: Partial<DataBarEvent>
): DataBarEvent {
  return {
    type: "data_bar" as const,
    id: "bar-id-1",
    ts: Date.now() * 1_000_000,
    version: "1.0",
    seq: 1,
    instrumentId,
    timeframe,
    open: "150.00",
    high: "151.00",
    low: "149.50",
    close: "150.50",
    volume: "1000",
    tsEvent: Date.now() * 1_000_000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PromptBuilder contextProviders", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "prompt-builder-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("addContextProvider registers a provider", async () => {
    const builder = new PromptBuilder({
      workspacePath: tmpDir,
      agentPublicKey: "test-pub-key",
      network: "testnet",
    });

    builder.addContextProvider(() => "DYNAMIC SECTION");

    const prompt = await builder.buildSystemPrompt();
    expect(prompt).toContain("DYNAMIC SECTION");
  });

  it("buildSystemPrompt includes provider output after static content", async () => {
    const builder = new PromptBuilder({
      workspacePath: tmpDir,
      agentPublicKey: "test-pub-key",
      network: "testnet",
    });

    builder.addContextProvider(() => "[TRADING DATA]");

    const prompt = await builder.buildSystemPrompt();

    // Static content should come first (SOUL, IDENTITY, etc.)
    const agentIdentityIdx = prompt.indexOf("[AGENT IDENTITY]");
    const tradingIdx = prompt.indexOf("[TRADING DATA]");
    expect(agentIdentityIdx).toBeGreaterThan(-1);
    expect(tradingIdx).toBeGreaterThan(agentIdentityIdx);
  });

  it("provider returning null is skipped without extra newlines", async () => {
    const builder = new PromptBuilder({
      workspacePath: tmpDir,
      agentPublicKey: "test-pub-key",
      network: "testnet",
    });

    builder.addContextProvider(() => null);

    const withProvider = await builder.buildSystemPrompt();

    // Create a fresh builder without provider for comparison
    const builder2 = new PromptBuilder({
      workspacePath: tmpDir,
      agentPublicKey: "test-pub-key",
      network: "testnet",
    });

    const withoutProvider = await builder2.buildSystemPrompt();
    expect(withProvider).toBe(withoutProvider);
  });

  it("multiple providers are concatenated in order", async () => {
    const builder = new PromptBuilder({
      workspacePath: tmpDir,
      agentPublicKey: "test-pub-key",
      network: "testnet",
    });

    builder.addContextProvider(() => "FIRST_SECTION");
    builder.addContextProvider(() => "SECOND_SECTION");
    builder.addContextProvider(() => null); // Should be skipped
    builder.addContextProvider(() => "THIRD_SECTION");

    const prompt = await builder.buildSystemPrompt();

    const firstIdx = prompt.indexOf("FIRST_SECTION");
    const secondIdx = prompt.indexOf("SECOND_SECTION");
    const thirdIdx = prompt.indexOf("THIRD_SECTION");

    expect(firstIdx).toBeGreaterThan(-1);
    expect(secondIdx).toBeGreaterThan(firstIdx);
    expect(thirdIdx).toBeGreaterThan(secondIdx);
  });

  it("existing file-based behavior unchanged with identityContext", async () => {
    const builder = new PromptBuilder({
      workspacePath: tmpDir,
      agentPublicKey: "test-pub-key",
      network: "testnet",
    });

    builder.addContextProvider(() => "CONTEXT_SECTION");

    const prompt = await builder.buildSystemPrompt({
      senderPublicKey: "sender-key",
      verified: true,
      conversationId: "conv-123",
    });

    // Should contain both the identity context AND the dynamic section
    expect(prompt).toContain("[CURRENT MESSAGE CONTEXT]");
    expect(prompt).toContain("sender-key");
    expect(prompt).toContain("CONTEXT_SECTION");
  });
});

describe("TradingContextBuilder - Bridge Status", () => {
  it("shows READY when bridge is connected", () => {
    const mock = new MockBridgeClient({ state: ConnectionState.READY });
    // Add some data so buildContext does not return null
    mock.setAccounts([{ accountId: "ACC-1", currency: "USD", balance: "10000" }]);
    const builder = new TradingContextBuilder(mock as unknown as import("../bridge-client.js").BridgeClient);

    const context = builder.buildContext();
    expect(context).not.toBeNull();
    expect(context).toContain("| Connection | READY |");
    expect(context).toContain("| Risk Engine | ACTIVE |");
  });

  it("shows DISCONNECTED and UNKNOWN risk when bridge is disconnected with cached data", () => {
    const mock = new MockBridgeClient({ state: ConnectionState.DISCONNECTED });
    // Add cached portfolio data so context is not null
    mock.setAccounts([{ accountId: "ACC-1", currency: "USD", balance: "5000" }]);
    const builder = new TradingContextBuilder(mock as unknown as import("../bridge-client.js").BridgeClient);

    const context = builder.buildContext();
    expect(context).not.toBeNull();
    expect(context).toContain("| Connection | DISCONNECTED |");
    expect(context).toContain("| Risk Engine | UNKNOWN |");
  });
});

describe("TradingContextBuilder - Portfolio sections", () => {
  let mock: MockBridgeClient;
  let builder: TradingContextBuilder;

  beforeEach(() => {
    mock = new MockBridgeClient({ state: ConnectionState.READY });
    builder = new TradingContextBuilder(mock as unknown as import("../bridge-client.js").BridgeClient);
  });

  it("account balances rendered as markdown table with correct columns", () => {
    mock.setAccounts([
      { accountId: "ACC-1", currency: "USD", balance: "100000.00", free: "80000.00", locked: "20000.00" },
      { accountId: "ACC-2", currency: "EUR", balance: "50000.00", free: "50000.00", locked: "0.00" },
    ]);

    const context = builder.buildContext()!;
    expect(context).toContain("## Account Balances");
    expect(context).toContain("| Account | Currency | Total | Free | Locked |");
    expect(context).toContain("| ACC-1 | USD | 100000.00 | 80000.00 | 20000.00 |");
    expect(context).toContain("| ACC-2 | EUR | 50000.00 | 50000.00 | 0.00 |");
  });

  it("open positions rendered with instrument, side, qty, entry price, unrealized PnL", () => {
    mock.setAccounts([{ accountId: "ACC-1" }]); // Need some data for non-null context
    mock.setPositions([
      {
        positionId: "POS-1",
        instrumentId: "AAPL",
        side: "LONG",
        quantity: "100",
        avgOpenPrice: "150.00",
        unrealizedPnl: "500.00",
        realizedPnl: "0",
        entryPrice: "150.00",
      },
    ]);

    const context = builder.buildContext()!;
    expect(context).toContain("## Open Positions");
    expect(context).toContain("| Instrument | Side | Qty | Entry Price | Unrealized PnL |");
    expect(context).toContain("| AAPL | LONG | 100 | 150.00 | 500.00 |");
  });

  it("open orders rendered with ID, instrument, side, type, qty, price, status", () => {
    mock.setAccounts([{ accountId: "ACC-1" }]);
    mock.setOrders([
      {
        clientOrderId: "ORD-1",
        instrumentId: "MSFT",
        orderSide: "BUY",
        orderType: "LIMIT",
        quantity: "50",
        filledQty: "0",
        avgPrice: "350.00",
        status: "ACCEPTED",
      },
    ]);

    const context = builder.buildContext()!;
    expect(context).toContain("## Open Orders");
    expect(context).toContain("| ID | Instrument | Side | Type | Qty | Price | Status |");
    expect(context).toContain("| ORD-1 | MSFT | BUY | LIMIT | 50 | 350.00 | ACCEPTED |");
  });

  it("empty portfolio shows placeholder messages", () => {
    // State is READY but no data -- we need at least one section to produce non-null
    // Actually with READY state and no data, buildContext checks hasPortfolioData
    // which will be false, but state != DISCONNECTED, so it will still render
    const context = builder.buildContext()!;
    expect(context).toContain("No account data");
    expect(context).toContain("No open positions");
    expect(context).toContain("No open orders");
  });

  it("all financial values displayed as strings, not converted to numbers", () => {
    mock.setAccounts([
      { accountId: "ACC-1", currency: "USD", balance: "100000.50", free: "80000.25", locked: "20000.25" },
    ]);
    mock.setPositions([
      {
        positionId: "POS-1",
        instrumentId: "AAPL",
        side: "LONG",
        quantity: "10",
        avgOpenPrice: "150.50",
        unrealizedPnl: "50.25",
        realizedPnl: "0",
        entryPrice: "150.50",
      },
    ]);

    const context = builder.buildContext()!;
    // Financial values should be exact string representations
    expect(context).toContain("100000.50");
    expect(context).toContain("80000.25");
    expect(context).toContain("150.50");
    expect(context).toContain("50.25");
  });
});

describe("TradingContextBuilder - Market data", () => {
  let mock: MockBridgeClient;
  let builder: TradingContextBuilder;

  beforeEach(() => {
    mock = new MockBridgeClient({ state: ConnectionState.READY });
    mock.setAccounts([{ accountId: "ACC-1" }]); // Need data for non-null context
    builder = new TradingContextBuilder(mock as unknown as import("../bridge-client.js").BridgeClient);
  });

  it("last 5 bars rendered per subscribed instrument/timeframe", () => {
    const bars: DataBarEvent[] = [];
    for (let i = 0; i < 5; i++) {
      bars.push(
        createMockBar("BTCUSDT.BINANCE", "1m", {
          seq: i + 1,
          open: `${30000 + i}.00`,
          high: `${30100 + i}.00`,
          low: `${29900 + i}.00`,
          close: `${30050 + i}.00`,
          volume: `${1000 + i * 100}`,
          // Use UTC midnight + i minutes for predictable HH:MM formatting
          tsEvent: new Date("2026-02-25T10:00:00Z").getTime() + i * 60_000,
        })
      );
    }
    mock.setBars("BTCUSDT.BINANCE", "1m", bars);

    const context = builder.buildContext()!;
    expect(context).toContain("### BTCUSDT.BINANCE (1m)");
    expect(context).toContain("| Time | Open | High | Low | Close | Volume |");
    expect(context).toContain("| 10:00 | 30000.00 | 30100.00 | 29900.00 | 30050.00 | 1000 |");
    expect(context).toContain("| 10:04 | 30004.00 | 30104.00 | 29904.00 | 30054.00 | 1400 |");
  });

  it("more than 5 bars: only last 5 shown", () => {
    const bars: DataBarEvent[] = [];
    for (let i = 0; i < 10; i++) {
      bars.push(
        createMockBar("AAPL", "5m", {
          seq: i + 1,
          open: `${150 + i}.00`,
          close: `${150 + i}.50`,
          tsEvent: new Date("2026-02-25T09:00:00Z").getTime() + i * 5 * 60_000,
        })
      );
    }
    mock.setBars("AAPL", "5m", bars);

    const context = builder.buildContext()!;
    expect(context).toContain("### AAPL (5m)");
    // Should NOT contain bar at index 0 (open: 150.00)
    // but SHOULD contain bar at index 5 (open: 155.00) through index 9 (open: 159.00)
    expect(context).not.toContain("| 09:00 |"); // First bar (index 0 at 09:00)
    expect(context).toContain("155.00"); // Bar at index 5
    expect(context).toContain("159.00"); // Bar at index 9
  });

  it("no subscriptions: shows 'No market data subscriptions'", () => {
    // No bars set
    const context = builder.buildContext()!;
    expect(context).toContain("No market data subscriptions");
  });
});

describe("TradingContextBuilder - Recent activity", () => {
  let mock: MockBridgeClient;
  let builder: TradingContextBuilder;

  beforeEach(() => {
    mock = new MockBridgeClient({ state: ConnectionState.READY });
    mock.setAccounts([{ accountId: "ACC-1" }]);
    builder = new TradingContextBuilder(mock as unknown as import("../bridge-client.js").BridgeClient);
  });

  it("recordAction adds entries to recent activity", () => {
    builder.recordAction("SUBMIT_ORDER", "Buy 100 AAPL @ market");

    const context = builder.buildContext()!;
    expect(context).toContain("## Recent Activity (Last 5 Actions)");
    expect(context).toContain("| Time | Action | Details |");
    expect(context).toContain("SUBMIT_ORDER");
    expect(context).toContain("Buy 100 AAPL @ market");
  });

  it("only last 5 actions retained (oldest trimmed)", () => {
    for (let i = 1; i <= 7; i++) {
      builder.recordAction(`ACTION_${i}`, `Details for action ${i}`);
    }

    const context = builder.buildContext()!;
    // Should NOT contain ACTION_1 or ACTION_2 (trimmed)
    expect(context).not.toContain("ACTION_1");
    expect(context).not.toContain("ACTION_2");
    // Should contain ACTION_3 through ACTION_7
    expect(context).toContain("ACTION_3");
    expect(context).toContain("ACTION_7");
  });

  it("empty activity shows 'No recent trading activity'", () => {
    const context = builder.buildContext()!;
    expect(context).toContain("No recent trading activity");
  });
});

describe("TradingContextBuilder - Full context", () => {
  it("buildContext returns complete markdown with all 6 sections wrapped in markers", () => {
    const mock = new MockBridgeClient({ state: ConnectionState.READY });
    mock.setAccounts([
      { accountId: "ACC-1", currency: "USD", balance: "100000.00", free: "80000.00", locked: "20000.00" },
    ]);
    mock.setPositions([
      {
        positionId: "POS-1",
        instrumentId: "AAPL",
        side: "LONG",
        quantity: "10",
        avgOpenPrice: "150.00",
        unrealizedPnl: "50.00",
        realizedPnl: "0",
        entryPrice: "150.00",
      },
    ]);
    mock.setOrders([
      {
        clientOrderId: "ORD-1",
        instrumentId: "MSFT",
        orderSide: "BUY",
        orderType: "LIMIT",
        quantity: "5",
        filledQty: "0",
        avgPrice: "350.00",
        status: "ACCEPTED",
      },
    ]);
    mock.setBars("AAPL", "1m", [
      createMockBar("AAPL", "1m", {
        tsEvent: new Date("2026-02-25T14:30:00Z").getTime(),
      }),
    ]);

    const builder = new TradingContextBuilder(mock as unknown as import("../bridge-client.js").BridgeClient);
    builder.recordAction("SUBMIT_ORDER", "Buy 10 AAPL");

    const context = builder.buildContext()!;

    // Check markers
    expect(context).toMatch(/^\[TRADING CONTEXT\]/);
    expect(context).toMatch(/\[END TRADING CONTEXT\]$/);

    // Check all 6 sections present
    expect(context).toContain("## Bridge Status");
    expect(context).toContain("## Account Balances");
    expect(context).toContain("## Open Positions");
    expect(context).toContain("## Open Orders");
    expect(context).toContain("## Recent Market Data (Last 5 Bars)");
    expect(context).toContain("## Recent Activity (Last 5 Actions)");
  });

  it("buildContext returns null when disconnected with no cached data", () => {
    const mock = new MockBridgeClient({ state: ConnectionState.DISCONNECTED });
    const builder = new TradingContextBuilder(mock as unknown as import("../bridge-client.js").BridgeClient);

    const context = builder.buildContext();
    expect(context).toBeNull();
  });

  it("toContextProvider returns a function compatible with PromptBuilder", () => {
    const mock = new MockBridgeClient({ state: ConnectionState.READY });
    mock.setAccounts([{ accountId: "ACC-1" }]);
    const builder = new TradingContextBuilder(mock as unknown as import("../bridge-client.js").BridgeClient);

    const provider: ContextProvider = builder.toContextProvider();
    expect(typeof provider).toBe("function");

    const result = provider();
    expect(typeof result).toBe("string");
    expect(result).toContain("[TRADING CONTEXT]");
  });
});

describe("TradingContextBuilder - Context freshness", () => {
  it("context reflects latest state on each buildContext call", () => {
    const mock = new MockBridgeClient({ state: ConnectionState.READY });
    mock.setAccounts([{ accountId: "ACC-1", balance: "10000" }]);
    const builder = new TradingContextBuilder(mock as unknown as import("../bridge-client.js").BridgeClient);

    // First call
    const context1 = builder.buildContext()!;
    expect(context1).toContain("10000");

    // Update state
    mock.setAccounts([{ accountId: "ACC-1", balance: "20000" }]);

    // Second call should reflect new state (not cached)
    const context2 = builder.buildContext()!;
    expect(context2).toContain("20000");
    expect(context2).not.toContain("10000");
  });
});
