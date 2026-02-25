/**
 * Unit tests for TradeMemoryRecorder.
 *
 * Tests cover:
 *   1. recordTrade -- encrypted content, tag construction, importance levels, error handling
 *   2. recallTrades -- tag filtering, base tag, limit parameter
 *   3. Integration with trading tools -- fire-and-forget pattern
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { TradeMemoryRecorder } from "../trade-memory.js";
import type { TradeEvent } from "../trade-memory.js";
import type { MemoryManager, RecallResult } from "../../../storage/memory/memory-manager.js";
import type { MemoryToken } from "../../../storage/memory/memory-types.js";
import { createTradingTools } from "../trading-tools.js";
import { ConnectionState } from "../types.js";
import type { BridgeClient } from "../bridge-client.js";
import type { ToolContext } from "../../../agent/tools/types.js";
import type { PositionState, OrderState, AccountState } from "../portfolio-cache.js";
import type { OrderEvent } from "../types.js";

// ---------------------------------------------------------------------------
// Mock MemoryManager factory
// ---------------------------------------------------------------------------

function createMockMemoryManager(): MemoryManager {
  const mockStoreResult: MemoryToken = {
    txid: "tx-abc123",
    uhrpUrl: "uhrp://abc123",
    tags: ["trade", "instrument:AAPL.XNAS"],
    importance: "high",
    createdAt: Date.now(),
  };

  const mockRecallResult: RecallResult = {
    memories: [
      {
        content: JSON.stringify({
          eventType: "trade_filled",
          instrument: "AAPL.XNAS",
          side: "BUY",
          quantity: "100",
          fillPrice: "150.00",
          timestamp: Date.now(),
        }),
        tags: ["trade", "instrument:AAPL.XNAS", "side:BUY", "type:trade_filled"],
        importance: "high",
        txid: "tx-recall-1",
        blockTimestamp: Date.now(),
        uhrpUrl: "uhrp://recall-1",
      },
      {
        content: JSON.stringify({
          eventType: "trade_submitted",
          instrument: "MSFT.XNAS",
          side: "SELL",
          quantity: "50",
          timestamp: Date.now(),
        }),
        tags: ["trade", "instrument:MSFT.XNAS", "side:SELL", "type:trade_submitted"],
        importance: "medium",
        txid: "tx-recall-2",
        blockTimestamp: Date.now(),
        uhrpUrl: "uhrp://recall-2",
      },
    ],
    total: 2,
    returned: 2,
  };

  return {
    store: vi.fn<[{ content: string; tags: string[]; importance: string }], Promise<MemoryToken>>()
      .mockResolvedValue(mockStoreResult),
    recall: vi.fn<[Record<string, unknown> | undefined], Promise<RecallResult>>()
      .mockResolvedValue(mockRecallResult),
    gc: vi.fn().mockResolvedValue({ removed: 0, remaining: 0 }),
  } as unknown as MemoryManager;
}

// ---------------------------------------------------------------------------
// Mock BridgeClient factory (for integration tests)
// ---------------------------------------------------------------------------

function createMockBridgeClient(): BridgeClient {
  const positions: ReadonlyMap<string, PositionState> = new Map<string, PositionState>();
  const orders: ReadonlyMap<string, OrderState> = new Map<string, OrderState>();
  const accounts: ReadonlyMap<string, AccountState> = new Map<string, AccountState>();

  return {
    get state() {
      return ConnectionState.READY;
    },
    get portfolio() {
      return { accounts, positions, orders };
    },
    submitOrder: vi.fn<[Record<string, unknown>], Promise<OrderEvent>>().mockResolvedValue({
      type: "evt_order" as const,
      id: "evt-1",
      ts: Date.now(),
      version: "1.0",
      seq: 1,
      correlationId: "corr-1",
      eventType: "SUBMITTED",
      clientOrderId: "order-abc123",
      instrumentId: "AAPL.XNAS",
      orderSide: "BUY",
      orderType: "MARKET",
      quantity: "100",
      filledQty: "0",
      status: "SUBMITTED",
      tsEvent: Date.now(),
    }),
    cancelOrder: vi.fn().mockResolvedValue({}),
    modifyOrder: vi.fn().mockResolvedValue({}),
    getPortfolio: vi.fn().mockResolvedValue({}),
    listInstruments: vi.fn().mockResolvedValue({ instruments: [] }),
    emergencyHalt: vi.fn().mockResolvedValue({}),
    subscribeBars: vi.fn().mockResolvedValue(undefined),
    unsubscribeBars: vi.fn().mockResolvedValue(undefined),
  } as unknown as BridgeClient;
}

const mockCtx: ToolContext = {
  wallet: {} as ToolContext["wallet"],
};

// ---------------------------------------------------------------------------
// 1. recordTrade
// ---------------------------------------------------------------------------

describe("recordTrade", () => {
  let memoryManager: MemoryManager;
  let recorder: TradeMemoryRecorder;

  beforeEach(() => {
    memoryManager = createMockMemoryManager();
    recorder = new TradeMemoryRecorder(memoryManager);
  });

  it("stores trade with encrypted content containing full event details", async () => {
    const event: TradeEvent = {
      eventType: "trade_filled",
      instrument: "AAPL.XNAS",
      side: "BUY",
      quantity: "100",
      fillPrice: "150.00",
      orderId: "order-1",
      reasoningHash: "abc123",
      timestamp: 1700000000000,
    };

    await recorder.recordTrade(event);

    expect(memoryManager.store).toHaveBeenCalledOnce();
    const storeArg = (memoryManager.store as ReturnType<typeof vi.fn>).mock.calls[0][0];

    // Content should be the full JSON of the event
    const parsed = JSON.parse(storeArg.content);
    expect(parsed.eventType).toBe("trade_filled");
    expect(parsed.instrument).toBe("AAPL.XNAS");
    expect(parsed.fillPrice).toBe("150.00");
    expect(parsed.reasoningHash).toBe("abc123");
  });

  it("tags include trade, instrument, side, and type", async () => {
    const event: TradeEvent = {
      eventType: "trade_submitted",
      instrument: "MSFT.XNAS",
      side: "SELL",
      quantity: "50",
      timestamp: Date.now(),
    };

    await recorder.recordTrade(event);

    const storeArg = (memoryManager.store as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(storeArg.tags).toContain("trade");
    expect(storeArg.tags).toContain("instrument:MSFT.XNAS");
    expect(storeArg.tags).toContain("side:SELL");
    expect(storeArg.tags).toContain("type:trade_submitted");
  });

  it("fills and position closes stored as high importance", async () => {
    const fillEvent: TradeEvent = {
      eventType: "trade_filled",
      instrument: "AAPL.XNAS",
      side: "BUY",
      quantity: "100",
      timestamp: Date.now(),
    };
    await recorder.recordTrade(fillEvent);

    let storeArg = (memoryManager.store as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(storeArg.importance).toBe("high");

    const closeEvent: TradeEvent = {
      eventType: "position_closed",
      instrument: "AAPL.XNAS",
      side: "SELL",
      quantity: "100",
      pnl: "500.00",
      timestamp: Date.now(),
    };
    await recorder.recordTrade(closeEvent);

    storeArg = (memoryManager.store as ReturnType<typeof vi.fn>).mock.calls[1][0];
    expect(storeArg.importance).toBe("high");
  });

  it("submissions and cancellations stored as medium importance", async () => {
    const submitEvent: TradeEvent = {
      eventType: "trade_submitted",
      instrument: "AAPL.XNAS",
      side: "BUY",
      quantity: "100",
      timestamp: Date.now(),
    };
    await recorder.recordTrade(submitEvent);

    let storeArg = (memoryManager.store as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(storeArg.importance).toBe("medium");

    const cancelEvent: TradeEvent = {
      eventType: "trade_canceled",
      instrument: "AAPL.XNAS",
      side: "BUY",
      quantity: "100",
      timestamp: Date.now(),
    };
    await recorder.recordTrade(cancelEvent);

    storeArg = (memoryManager.store as ReturnType<typeof vi.fn>).mock.calls[1][0];
    expect(storeArg.importance).toBe("medium");
  });

  it("returns null (not throws) when memory store fails", async () => {
    (memoryManager.store as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("BSV network unavailable"),
    );

    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await recorder.recordTrade({
      eventType: "trade_filled",
      instrument: "AAPL.XNAS",
      side: "BUY",
      quantity: "100",
      timestamp: Date.now(),
    });

    expect(result).toBeNull();
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// 2. recallTrades
// ---------------------------------------------------------------------------

describe("recallTrades", () => {
  let memoryManager: MemoryManager;
  let recorder: TradeMemoryRecorder;

  beforeEach(() => {
    memoryManager = createMockMemoryManager();
    recorder = new TradeMemoryRecorder(memoryManager);
  });

  it("always includes trade base tag", async () => {
    await recorder.recallTrades();

    const recallArg = (memoryManager.recall as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(recallArg.tags).toContain("trade");
  });

  it("filters by instrument tag when instrument specified", async () => {
    await recorder.recallTrades({ instrument: "AAPL.XNAS" });

    const recallArg = (memoryManager.recall as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(recallArg.tags).toContain("trade");
    expect(recallArg.tags).toContain("instrument:AAPL.XNAS");
  });

  it("filters by side tag when side specified", async () => {
    await recorder.recallTrades({ side: "BUY" });

    const recallArg = (memoryManager.recall as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(recallArg.tags).toContain("trade");
    expect(recallArg.tags).toContain("side:BUY");
  });

  it("respects limit parameter", async () => {
    await recorder.recallTrades({ limit: 5 });

    const recallArg = (memoryManager.recall as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(recallArg.limit).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// 3. Integration with trading tools
// ---------------------------------------------------------------------------

describe("Integration with trading tools", () => {
  it("submit_order calls recordTrade after successful execution", async () => {
    const memoryManager = createMockMemoryManager();
    const recorder = new TradeMemoryRecorder(memoryManager);
    const recordSpy = vi.spyOn(recorder, "recordTrade");
    const client = createMockBridgeClient();
    const tools = createTradingTools(client, undefined, recorder);
    const submitTool = tools.find((t) => t.definition.name === "nautilus_submit_order")!;

    await submitTool.execute(
      {
        symbol: "AAPL.XNAS",
        orderSide: "BUY",
        orderType: "MARKET",
        quantity: "100",
      },
      mockCtx,
    );

    // Give the fire-and-forget Promise a tick to resolve
    await new Promise((r) => setTimeout(r, 10));

    expect(recordSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "trade_submitted",
        instrument: "AAPL.XNAS",
        side: "BUY",
        quantity: "100",
      }),
    );
  });

  it("recordTrade failure does not affect tool response (fire-and-forget)", async () => {
    const memoryManager = createMockMemoryManager();
    (memoryManager.store as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("BSV unavailable"),
    );
    const recorder = new TradeMemoryRecorder(memoryManager);
    const client = createMockBridgeClient();

    // Suppress console.warn from the fire-and-forget error
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const tools = createTradingTools(client, undefined, recorder);
    const submitTool = tools.find((t) => t.definition.name === "nautilus_submit_order")!;

    const result = await submitTool.execute(
      {
        symbol: "AAPL.XNAS",
        orderSide: "BUY",
        orderType: "MARKET",
        quantity: "100",
      },
      mockCtx,
    );

    // Tool response is successful regardless of memory failure
    expect(result.content).toContain("Order ACCEPTED");
    expect(result.isError).toBeUndefined();

    // Give fire-and-forget time to complete
    await new Promise((r) => setTimeout(r, 10));

    consoleSpy.mockRestore();
  });
});
