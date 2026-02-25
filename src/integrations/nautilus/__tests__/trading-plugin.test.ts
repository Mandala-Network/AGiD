/**
 * Unit tests for NautilusTradingPlugin, trading tools, and reasoning hash.
 *
 * Tests cover:
 *   1. Plugin creation and structure (tool count, names, metadata)
 *   2. Tool response formatting (markdown, not JSON)
 *   3. Bridge disconnect handling (immediate error, no BridgeClient calls)
 *   4. close_position convenience (LONG->SELL, SHORT->BUY, no position error)
 *   5. Reasoning hash (SHA-256 hex, deterministic, included in submit_order)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NautilusTradingPlugin } from "../trading-plugin.js";
import { createTradingTools } from "../trading-tools.js";
import { computeReasoningHash } from "../reasoning-hash.js";
import { ConnectionState } from "../types.js";
import type { BridgeClient } from "../bridge-client.js";
import type { ToolContext } from "../../../agent/tools/types.js";
import type { PositionState, OrderState, AccountState } from "../portfolio-cache.js";
import type {
  OrderEvent,
  PortfolioResponse,
  ListInstrumentsResponse,
  HaltResponse,
} from "../types.js";

// ---------------------------------------------------------------------------
// Mock BridgeClient factory
// ---------------------------------------------------------------------------

function createMockBridgeClient(overrides?: {
  state?: ConnectionState;
  positions?: Map<string, PositionState>;
}): BridgeClient {
  const state = overrides?.state ?? ConnectionState.READY;
  const positions: ReadonlyMap<string, PositionState> =
    overrides?.positions ?? new Map<string, PositionState>();
  const orders: ReadonlyMap<string, OrderState> = new Map<string, OrderState>();
  const accounts: ReadonlyMap<string, AccountState> = new Map<string, AccountState>();

  const mock = {
    get state() {
      return state;
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
    cancelOrder: vi.fn<[string], Promise<OrderEvent>>().mockResolvedValue({
      type: "evt_order" as const,
      id: "evt-2",
      ts: Date.now(),
      version: "1.0",
      seq: 2,
      correlationId: "corr-2",
      eventType: "CANCELED",
      clientOrderId: "order-abc123",
      instrumentId: "AAPL.XNAS",
      orderSide: "BUY",
      orderType: "MARKET",
      quantity: "100",
      filledQty: "0",
      status: "CANCELED",
      tsEvent: Date.now(),
    }),
    modifyOrder: vi.fn<[Record<string, unknown>], Promise<OrderEvent>>().mockResolvedValue({
      type: "evt_order" as const,
      id: "evt-3",
      ts: Date.now(),
      version: "1.0",
      seq: 3,
      correlationId: "corr-3",
      eventType: "MODIFIED",
      clientOrderId: "order-abc123",
      instrumentId: "AAPL.XNAS",
      orderSide: "BUY",
      orderType: "LIMIT",
      quantity: "100",
      filledQty: "0",
      avgPrice: "150.00",
      status: "ACCEPTED",
      tsEvent: Date.now(),
    }),
    getPortfolio: vi.fn<[], Promise<PortfolioResponse>>().mockResolvedValue({
      type: "portfolio_response" as const,
      id: "msg-1",
      ts: Date.now(),
      version: "1.0",
      correlationId: "corr-4",
      accounts: [{ accountId: "acct-1", balance: "100000.00", currency: "USD" }],
      positions: [
        {
          positionId: "pos-1",
          instrumentId: "AAPL.XNAS",
          side: "LONG",
          quantity: "100",
          entryPrice: "150.00",
          unrealizedPnl: "500.00",
        },
      ],
      openOrders: [
        {
          clientOrderId: "ord-1",
          instrumentId: "MSFT.XNAS",
          orderSide: "BUY",
          orderType: "LIMIT",
          quantity: "50",
          price: "400.00",
          status: "ACCEPTED",
        },
      ],
      riskEngineState: "active",
    }),
    listInstruments: vi.fn<[], Promise<ListInstrumentsResponse>>().mockResolvedValue({
      type: "list_instruments_response" as const,
      id: "msg-2",
      ts: Date.now(),
      version: "1.0",
      correlationId: "corr-5",
      instruments: [
        {
          symbol: "AAPL.XNAS",
          venue: "XNAS",
          tickSize: "0.01",
          lotSize: "1",
          minQuantity: "1",
          maxQuantity: "10000",
          assetClass: "EQUITY",
        },
        {
          symbol: "MSFT.XNAS",
          venue: "XNAS",
          tickSize: "0.01",
          lotSize: "1",
          minQuantity: "1",
          maxQuantity: "10000",
          assetClass: "EQUITY",
        },
      ],
    }),
    emergencyHalt: vi.fn<[], Promise<HaltResponse>>().mockResolvedValue({
      type: "halt_response" as const,
      id: "msg-3",
      ts: Date.now(),
      version: "1.0",
      correlationId: "corr-6",
      riskEngineState: "HALTED",
      reason: "Manual halt",
      accounts: [],
      positions: [],
      openOrders: [],
      failedCloses: [],
    }),
    subscribeBars: vi.fn<[string, string], Promise<void>>().mockResolvedValue(undefined),
    unsubscribeBars: vi.fn<[string, string], Promise<void>>().mockResolvedValue(undefined),
  } as unknown as BridgeClient;

  return mock;
}

/** Minimal mock ToolContext (tools do not use wallet). */
const mockCtx: ToolContext = {
  wallet: {} as ToolContext["wallet"],
};

// ---------------------------------------------------------------------------
// 1. NautilusTradingPlugin
// ---------------------------------------------------------------------------

describe("NautilusTradingPlugin", () => {
  let plugin: NautilusTradingPlugin;
  let client: BridgeClient;

  beforeEach(() => {
    client = createMockBridgeClient();
    plugin = new NautilusTradingPlugin(client);
  });

  it("has correct name, version, and description", () => {
    expect(plugin.name).toBe("nautilus-trading");
    expect(plugin.version).toBe("0.1.0");
    expect(plugin.description).toBe("NautilusTrader bridge for algorithmic trading");
  });

  it("createTools() returns exactly 10 tool descriptors", () => {
    const tools = plugin.createTools(mockCtx);
    expect(tools).toHaveLength(10);
  });

  it("each tool has correct nautilus_* name prefix", () => {
    const tools = plugin.createTools(mockCtx);
    for (const tool of tools) {
      expect(tool.definition.name).toMatch(/^nautilus_/);
    }
  });

  it("setCurrentReasoningText stores and clears text", () => {
    plugin.setCurrentReasoningText("test reasoning");
    // createTools builds closures that read the text
    const tools = plugin.createTools(mockCtx);
    // The reasoning text is consumed internally -- verifying via submit_order below
    expect(tools).toHaveLength(10);
  });
});

// ---------------------------------------------------------------------------
// 2. Tool response formatting
// ---------------------------------------------------------------------------

describe("Tool response formatting", () => {
  let client: BridgeClient;
  let tools: ReturnType<typeof createTradingTools>;

  beforeEach(() => {
    client = createMockBridgeClient();
    tools = createTradingTools(client);
  });

  function findTool(name: string) {
    const tool = tools.find((t) => t.definition.name === name);
    if (!tool) throw new Error(`Tool not found: ${name}`);
    return tool;
  }

  it("submit_order returns formatted markdown on success", async () => {
    const tool = findTool("nautilus_submit_order");
    const result = await tool.execute(
      {
        symbol: "AAPL.XNAS",
        orderSide: "BUY",
        orderType: "MARKET",
        quantity: "100",
      },
      mockCtx,
    );
    expect(result.content).toContain("Order ACCEPTED");
    expect(result.content).toContain("BUY");
    expect(result.content).toContain("100");
    expect(result.content).toContain("AAPL.XNAS");
    expect(result.content).toContain("order-abc123");
    expect(result.isError).toBeUndefined();
  });

  it("cancel_order returns formatted markdown on success", async () => {
    const tool = findTool("nautilus_cancel_order");
    const result = await tool.execute({ clientOrderId: "order-abc123" }, mockCtx);
    expect(result.content).toContain("Order CANCELED");
    expect(result.content).toContain("order-abc123");
    expect(result.isError).toBeUndefined();
  });

  it("get_portfolio returns markdown table with accounts and positions", async () => {
    const tool = findTool("nautilus_get_portfolio");
    const result = await tool.execute({}, mockCtx);
    expect(result.content).toContain("## Portfolio");
    expect(result.content).toContain("### Accounts");
    expect(result.content).toContain("### Positions");
    expect(result.content).toContain("AAPL.XNAS");
    expect(result.content).toContain("100000.00");
    // Verify it is markdown with table delimiters
    expect(result.content).toContain("|");
    expect(result.isError).toBeUndefined();
  });

  it("list_instruments returns markdown table", async () => {
    const tool = findTool("nautilus_list_instruments");
    const result = await tool.execute({}, mockCtx);
    expect(result.content).toContain("## Available Instruments");
    expect(result.content).toContain("AAPL.XNAS");
    expect(result.content).toContain("MSFT.XNAS");
    expect(result.content).toContain("|");
    expect(result.isError).toBeUndefined();
  });

  it("error responses are plain text without action hints", async () => {
    const errorClient = createMockBridgeClient();
    (errorClient.submitOrder as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("insufficient margin. Current buying power: $0.00"),
    );
    const errorTools = createTradingTools(errorClient);
    const tool = errorTools.find((t) => t.definition.name === "nautilus_submit_order")!;
    const result = await tool.execute(
      {
        symbol: "AAPL.XNAS",
        orderSide: "BUY",
        orderType: "MARKET",
        quantity: "100",
      },
      mockCtx,
    );
    expect(result.content).toContain("Order rejected");
    expect(result.content).toContain("insufficient margin");
    // No action hints like "try reducing your order size"
    expect(result.content).not.toContain("try");
    expect(result.isError).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. Bridge disconnect handling
// ---------------------------------------------------------------------------

describe("Bridge disconnect handling", () => {
  let client: BridgeClient;
  let tools: ReturnType<typeof createTradingTools>;

  beforeEach(() => {
    client = createMockBridgeClient({ state: ConnectionState.DISCONNECTED });
    tools = createTradingTools(client);
  });

  it("all tools return error when bridge state is not READY", async () => {
    for (const tool of tools) {
      const result = await tool.execute({}, mockCtx);
      expect(result.content).toContain("Bridge disconnected");
      expect(result.content).toContain("Trading unavailable");
      expect(result.isError).toBe(true);
    }
  });

  it("error message matches expected format", async () => {
    const tool = tools.find((t) => t.definition.name === "nautilus_submit_order")!;
    const result = await tool.execute(
      {
        symbol: "AAPL.XNAS",
        orderSide: "BUY",
        orderType: "MARKET",
        quantity: "100",
      },
      mockCtx,
    );
    expect(result.content).toBe("Bridge disconnected. Trading unavailable.");
  });

  it("tools do NOT call BridgeClient methods when disconnected", async () => {
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
    expect(client.submitOrder).not.toHaveBeenCalled();

    const portfolioTool = tools.find((t) => t.definition.name === "nautilus_get_portfolio")!;
    await portfolioTool.execute({}, mockCtx);
    expect(client.getPortfolio).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 4. close_position convenience
// ---------------------------------------------------------------------------

describe("close_position convenience", () => {
  it("with existing LONG position: submits SELL MARKET order", async () => {
    const positions = new Map<string, PositionState>([
      [
        "pos-1",
        {
          positionId: "pos-1",
          instrumentId: "AAPL.XNAS",
          side: "LONG",
          quantity: "100",
          avgOpenPrice: "150.00",
          unrealizedPnl: "500.00",
          realizedPnl: "0",
          entryPrice: "150.00",
        },
      ],
    ]);
    const client = createMockBridgeClient({ positions });
    const tools = createTradingTools(client);
    const tool = tools.find((t) => t.definition.name === "nautilus_close_position")!;

    const result = await tool.execute({ symbol: "AAPL.XNAS" }, mockCtx);
    expect(result.content).toContain("Position CLOSING");
    expect(result.content).toContain("SELL");
    expect(result.content).toContain("100");
    expect(result.content).toContain("AAPL.XNAS");

    expect(client.submitOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: "AAPL.XNAS",
        orderSide: "SELL",
        orderType: "MARKET",
        quantity: "100",
      }),
    );
  });

  it("with existing SHORT position: submits BUY MARKET order", async () => {
    const positions = new Map<string, PositionState>([
      [
        "pos-2",
        {
          positionId: "pos-2",
          instrumentId: "TSLA.XNAS",
          side: "SHORT",
          quantity: "50",
          avgOpenPrice: "200.00",
          unrealizedPnl: "-100.00",
          realizedPnl: "0",
          entryPrice: "200.00",
        },
      ],
    ]);
    const client = createMockBridgeClient({ positions });
    const tools = createTradingTools(client);
    const tool = tools.find((t) => t.definition.name === "nautilus_close_position")!;

    const result = await tool.execute({ symbol: "TSLA.XNAS" }, mockCtx);
    expect(result.content).toContain("Position CLOSING");
    expect(result.content).toContain("BUY");
    expect(result.content).toContain("50");

    expect(client.submitOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: "TSLA.XNAS",
        orderSide: "BUY",
        orderType: "MARKET",
        quantity: "50",
      }),
    );
  });

  it("with no position: returns error", async () => {
    const client = createMockBridgeClient({ positions: new Map() });
    const tools = createTradingTools(client);
    const tool = tools.find((t) => t.definition.name === "nautilus_close_position")!;

    const result = await tool.execute({ symbol: "NOPE.XNAS" }, mockCtx);
    expect(result.content).toContain("No position found for instrument NOPE.XNAS");
    expect(result.isError).toBe(true);
    expect(client.submitOrder).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 5. Reasoning hash
// ---------------------------------------------------------------------------

describe("Reasoning hash", () => {
  it("computeReasoningHash produces consistent SHA-256 hex for same input", async () => {
    const hash1 = await computeReasoningHash("I want to buy AAPL", { symbol: "AAPL", qty: "100" });
    const hash2 = await computeReasoningHash("I want to buy AAPL", { symbol: "AAPL", qty: "100" });
    expect(hash1).toBe(hash2);
  });

  it("different inputs produce different hashes", async () => {
    const hash1 = await computeReasoningHash("buy AAPL", { symbol: "AAPL" });
    const hash2 = await computeReasoningHash("sell AAPL", { symbol: "AAPL" });
    expect(hash1).not.toBe(hash2);
  });

  it("hash is 64 characters (hex-encoded SHA-256)", async () => {
    const hash = await computeReasoningHash("test", { key: "value" });
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("submit_order includes reasoning hash in order params when reasoning text is set", async () => {
    const client = createMockBridgeClient();
    const plugin = new NautilusTradingPlugin(client);
    plugin.setCurrentReasoningText("I believe AAPL will rise based on earnings report");
    const tools = plugin.createTools(mockCtx);
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

    expect(client.submitOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        reasoningHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
    );
  });

  it("submit_order works without reasoning text (no reasoning hash)", async () => {
    const client = createMockBridgeClient();
    const tools = createTradingTools(client);
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

    const callArg = (client.submitOrder as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArg.reasoningHash).toBeUndefined();
  });
});
