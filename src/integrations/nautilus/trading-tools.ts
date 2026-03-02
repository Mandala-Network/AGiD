/**
 * Trading Tools
 *
 * Creates 11 trading tool descriptors for the AGiD agent to interact with
 * NautilusTrader via the BridgeClient. Each tool produces formatted markdown
 * responses (not raw JSON) and checks bridge connectivity before execution.
 *
 * Tools:
 *   1. nautilus_submit_order       7. nautilus_list_instruments
 *   2. nautilus_cancel_order       8. nautilus_subscribe_data
 *   3. nautilus_modify_order       9. nautilus_unsubscribe_data
 *   4. nautilus_close_position    10. nautilus_emergency_halt
 *   5. nautilus_get_portfolio     11. nautilus_set_instrument
 *   6. nautilus_get_instrument
 *
 * Note: get_risk_state is NOT a tool -- risk state is always included in
 * the LLM context alongside portfolio data (per CONTEXT.md decision).
 */

import type { ToolDescriptor, ToolContext } from "../../agent/tools/types.js";
import type { ToolResult } from "../../types/agent-types.js";
import type { BridgeClient } from "./bridge-client.js";
import type { TradeMemoryRecorder } from "./trade-memory.js";
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
// Bridge state guard
// ---------------------------------------------------------------------------

function checkBridgeState(client: BridgeClient): ToolResult | null {
  if (client.state !== ConnectionState.READY) {
    return {
      content: "Bridge disconnected. Trading unavailable.",
      isError: true,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create 11 trading tool descriptors that delegate to BridgeClient methods.
 *
 * @param bridgeClient - The BridgeClient instance for trading operations
 * @param getReasoningText - Closure returning the current turn's assistant text (or null)
 * @param tradeMemoryRecorder - Optional recorder for on-chain trade event storage
 * @returns Array of 11 ToolDescriptor objects
 */
export function createTradingTools(
  bridgeClient: BridgeClient,
  getReasoningText?: () => string | null,
  tradeMemoryRecorder?: TradeMemoryRecorder,
): ToolDescriptor[] {
  return [
    // 1. Submit Order
    createSubmitOrder(bridgeClient, getReasoningText, tradeMemoryRecorder),
    // 2. Cancel Order
    createCancelOrder(bridgeClient, tradeMemoryRecorder),
    // 3. Modify Order
    createModifyOrder(bridgeClient),
    // 4. Close Position
    createClosePosition(bridgeClient, getReasoningText, tradeMemoryRecorder),
    // 5. Get Portfolio
    createGetPortfolio(bridgeClient),
    // 6. Get Instrument
    createGetInstrument(bridgeClient),
    // 7. List Instruments
    createListInstruments(bridgeClient),
    // 8. Subscribe Data
    createSubscribeData(bridgeClient),
    // 9. Unsubscribe Data
    createUnsubscribeData(bridgeClient),
    // 10. Emergency Halt
    createEmergencyHalt(bridgeClient),
    // 11. Set Instrument (hot-add)
    createSetInstrument(bridgeClient),
  ];
}

// ---------------------------------------------------------------------------
// 1. Submit Order
// ---------------------------------------------------------------------------

function createSubmitOrder(
  client: BridgeClient,
  getReasoningText?: () => string | null,
  recorder?: TradeMemoryRecorder,
): ToolDescriptor {
  const execute: ToolExecuteFn = async (params) => {
    const guard = checkBridgeState(client);
    if (guard) return guard;

    try {
      const symbol = params.symbol as string;
      const orderSide = params.orderSide as string;
      const orderType = params.orderType as string;
      const quantity = params.quantity as string;
      const price = params.price as string | undefined;
      const triggerPrice = params.triggerPrice as string | undefined;
      const timeInForce = params.timeInForce as string | undefined;

      // Compute reasoning hash if reasoning text is available
      let reasoningHash: string | undefined;
      const reasoningText = getReasoningText?.() ?? null;
      if (reasoningText) {
        reasoningHash = await computeReasoningHash(reasoningText, params);
      }

      const orderParams: Record<string, unknown> = {
        symbol,
        orderSide,
        orderType,
        quantity,
      };
      if (price !== undefined) orderParams.price = price;
      if (triggerPrice !== undefined) orderParams.triggerPrice = triggerPrice;
      if (timeInForce !== undefined) orderParams.timeInForce = timeInForce;
      if (reasoningHash !== undefined) orderParams.reasoningHash = reasoningHash;

      const result = await client.submitOrder(orderParams as Parameters<typeof client.submitOrder>[0]) as Record<string, unknown>;
      const orderId = (result.clientOrderId as string) ?? (result.correlationId as string) ?? "pending";

      // Fire-and-forget trade memory recording
      recorder?.recordTrade({
        eventType: "trade_submitted",
        instrument: symbol,
        side: orderSide as "BUY" | "SELL",
        orderType,
        quantity,
        price,
        orderId,
        reasoningHash,
        timestamp: Date.now(),
      }).catch((err) => console.warn("Trade memory storage failed:", err));

      const priceStr = orderType === "MARKET" ? "market" : `$${price ?? "N/A"}`;
      return {
        content: `Order SUBMITTED: ${orderSide} ${quantity} ${symbol} @ ${priceStr} (status: ${(result.status as string) ?? "SUBMITTED"})`,
      };
    } catch (err) {
      return {
        content: `Order rejected: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }
  };

  return {
    definition: {
      name: "nautilus_submit_order",
      description:
        "Submit a trading order through NautilusTrader. Supports MARKET, LIMIT, STOP_MARKET, and STOP_LIMIT order types.",
      input_schema: {
        type: "object",
        properties: {
          symbol: { type: "string", description: "Instrument symbol (e.g. AAPL.XNAS)" },
          orderSide: { type: "string", description: "BUY or SELL" },
          orderType: { type: "string", description: "MARKET, LIMIT, STOP_MARKET, or STOP_LIMIT" },
          quantity: { type: "string", description: "Order quantity as decimal string" },
          price: { type: "string", description: "Limit price as decimal string (required for LIMIT/STOP_LIMIT)" },
          triggerPrice: { type: "string", description: "Trigger price for STOP orders" },
          timeInForce: { type: "string", description: "GTC, IOC, FOK, or DAY (default: GTC)" },
        },
        required: ["symbol", "orderSide", "orderType", "quantity"],
      },
    },
    execute,
    requiresWallet: false,
  };
}

// ---------------------------------------------------------------------------
// 2. Cancel Order
// ---------------------------------------------------------------------------

function createCancelOrder(
  client: BridgeClient,
  recorder?: TradeMemoryRecorder,
): ToolDescriptor {
  const execute: ToolExecuteFn = async (params) => {
    const guard = checkBridgeState(client);
    if (guard) return guard;

    try {
      const clientOrderId = params.clientOrderId as string;
      await client.cancelOrder(clientOrderId);

      // Fire-and-forget trade memory recording
      recorder?.recordTrade({
        eventType: "trade_canceled",
        instrument: "unknown",
        side: "BUY",
        quantity: "0",
        orderId: clientOrderId,
        timestamp: Date.now(),
      }).catch((err) => console.warn("Trade memory storage failed:", err));

      return { content: `Order CANCELED: ID ${clientOrderId}` };
    } catch (err) {
      return {
        content: `Cancel failed: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }
  };

  return {
    definition: {
      name: "nautilus_cancel_order",
      description: "Cancel an open order by its client order ID.",
      input_schema: {
        type: "object",
        properties: {
          clientOrderId: { type: "string", description: "The client order ID to cancel" },
        },
        required: ["clientOrderId"],
      },
    },
    execute,
    requiresWallet: false,
  };
}

// ---------------------------------------------------------------------------
// 3. Modify Order
// ---------------------------------------------------------------------------

function createModifyOrder(client: BridgeClient): ToolDescriptor {
  const execute: ToolExecuteFn = async (params) => {
    const guard = checkBridgeState(client);
    if (guard) return guard;

    try {
      const clientOrderId = params.clientOrderId as string;
      const modifyParams: Record<string, unknown> = { clientOrderId };
      if (params.price !== undefined) modifyParams.price = params.price;
      if (params.quantity !== undefined) modifyParams.quantity = params.quantity;

      await client.modifyOrder(modifyParams as Parameters<typeof client.modifyOrder>[0]);

      const changes: string[] = [];
      if (params.price !== undefined) changes.push(`new price: ${params.price as string}`);
      if (params.quantity !== undefined) changes.push(`new quantity: ${params.quantity as string}`);

      return {
        content: `Order MODIFIED: ID ${clientOrderId}${changes.length > 0 ? ", " + changes.join(", ") : ""}`,
      };
    } catch (err) {
      return {
        content: `Modify failed: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }
  };

  return {
    definition: {
      name: "nautilus_modify_order",
      description: "Modify an existing order's price or quantity.",
      input_schema: {
        type: "object",
        properties: {
          clientOrderId: { type: "string", description: "The client order ID to modify" },
          price: { type: "string", description: "New limit price as decimal string" },
          quantity: { type: "string", description: "New quantity as decimal string" },
        },
        required: ["clientOrderId"],
      },
    },
    execute,
    requiresWallet: false,
  };
}

// ---------------------------------------------------------------------------
// 4. Close Position (convenience tool)
// ---------------------------------------------------------------------------

function createClosePosition(
  client: BridgeClient,
  getReasoningText?: () => string | null,
  recorder?: TradeMemoryRecorder,
): ToolDescriptor {
  const execute: ToolExecuteFn = async (params) => {
    const guard = checkBridgeState(client);
    if (guard) return guard;

    try {
      const symbol = params.symbol as string;

      // Look up position from portfolio cache
      const positions = client.portfolio.positions;
      let foundPosition: { side: string; quantity: string; instrumentId: string } | null = null;

      for (const [_id, pos] of positions) {
        if (pos.instrumentId === symbol) {
          foundPosition = { side: pos.side, quantity: pos.quantity, instrumentId: pos.instrumentId };
          break;
        }
      }

      if (!foundPosition) {
        return {
          content: `No position found for instrument ${symbol}.`,
          isError: true,
        };
      }

      // Determine opposite side for closing
      const closeSide = foundPosition.side === "LONG" || foundPosition.side === "BUY" ? "SELL" : "BUY";

      // Compute reasoning hash if reasoning text is available
      let reasoningHash: string | undefined;
      const reasoningText = getReasoningText?.() ?? null;
      if (reasoningText) {
        reasoningHash = await computeReasoningHash(reasoningText, params);
      }

      const orderParams: Record<string, unknown> = {
        symbol,
        orderSide: closeSide,
        orderType: "MARKET",
        quantity: foundPosition.quantity,
      };
      if (reasoningHash !== undefined) orderParams.reasoningHash = reasoningHash;

      const result = await client.submitOrder(orderParams as Parameters<typeof client.submitOrder>[0]);

      // Fire-and-forget trade memory recording
      recorder?.recordTrade({
        eventType: "position_closed",
        instrument: symbol,
        side: closeSide as "BUY" | "SELL",
        orderType: "MARKET",
        quantity: foundPosition.quantity,
        orderId: result.clientOrderId,
        reasoningHash,
        timestamp: Date.now(),
      }).catch((err) => console.warn("Trade memory storage failed:", err));

      return {
        content: `Position CLOSING: ${closeSide} ${foundPosition.quantity} ${symbol} @ market, ID: ${result.clientOrderId}`,
      };
    } catch (err) {
      return {
        content: `Close position failed: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }
  };

  return {
    definition: {
      name: "nautilus_close_position",
      description:
        "Close an existing position by submitting an opposite-side market order. Automatically looks up position side and quantity.",
      input_schema: {
        type: "object",
        properties: {
          symbol: { type: "string", description: "Instrument symbol to close (e.g. AAPL.XNAS)" },
        },
        required: ["symbol"],
      },
    },
    execute,
    requiresWallet: false,
  };
}

// ---------------------------------------------------------------------------
// 5. Get Portfolio
// ---------------------------------------------------------------------------

function createGetPortfolio(client: BridgeClient): ToolDescriptor {
  const execute: ToolExecuteFn = async () => {
    const guard = checkBridgeState(client);
    if (guard) return guard;

    try {
      const response = await client.getPortfolio();

      // Format accounts
      let md = "## Portfolio\n\n";

      if (response.accounts.length > 0) {
        md += "### Accounts\n\n";
        md += "| Account | Currency | Total | Free | Locked |\n";
        md += "|---------|----------|-------|------|--------|\n";
        for (const acct of response.accounts) {
          const balances = acct["balances"] as Array<Record<string, string>> | undefined;
          if (balances && balances.length > 0) {
            for (const bal of balances) {
              md += `| ${acct["accountId"] ?? "N/A"} | ${bal.currency ?? "N/A"} | ${bal.total ?? "N/A"} | ${bal.free ?? "N/A"} | ${bal.locked ?? "N/A"} |\n`;
            }
          } else {
            md += `| ${acct["accountId"] ?? "N/A"} | ${acct["currency"] ?? "N/A"} | ${acct["total"] ?? "N/A"} | ${acct["free"] ?? "N/A"} | ${acct["locked"] ?? "N/A"} |\n`;
          }
        }
        md += "\n";
      }

      // Format positions
      if (response.positions.length > 0) {
        md += "### Positions\n\n";
        md += "| Instrument | Side | Qty | Entry | Unrealized PnL |\n";
        md += "|------------|------|-----|-------|----------------|\n";
        for (const pos of response.positions) {
          md += `| ${pos["instrumentId"] ?? "N/A"} | ${pos["side"] ?? "N/A"} | ${pos["quantity"] ?? "N/A"} | ${pos["entryPrice"] ?? "N/A"} | ${pos["unrealizedPnl"] ?? "N/A"} |\n`;
        }
        md += "\n";
      }

      // Format open orders
      if (response.openOrders.length > 0) {
        md += "### Open Orders\n\n";
        md += "| ID | Instrument | Side | Type | Qty | Price | Status |\n";
        md += "|----|------------|------|------|-----|-------|--------|\n";
        for (const ord of response.openOrders) {
          md += `| ${ord["clientOrderId"] ?? "N/A"} | ${ord["instrumentId"] ?? "N/A"} | ${ord["orderSide"] ?? "N/A"} | ${ord["orderType"] ?? "N/A"} | ${ord["quantity"] ?? "N/A"} | ${ord["price"] ?? "market"} | ${ord["status"] ?? "N/A"} |\n`;
        }
        md += "\n";
      }

      if (response.accounts.length === 0 && response.positions.length === 0 && response.openOrders.length === 0) {
        md += "No accounts, positions, or open orders.\n";
      }

      return { content: md.trim() };
    } catch (err) {
      return {
        content: `Portfolio query failed: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }
  };

  return {
    definition: {
      name: "nautilus_get_portfolio",
      description:
        "Get the current portfolio including accounts, positions with unrealized PnL, and open orders.",
      input_schema: {
        type: "object",
        properties: {},
        required: [],
      },
    },
    execute,
    requiresWallet: false,
  };
}

// ---------------------------------------------------------------------------
// 6. Get Instrument
// ---------------------------------------------------------------------------

function createGetInstrument(client: BridgeClient): ToolDescriptor {
  const execute: ToolExecuteFn = async (params) => {
    const guard = checkBridgeState(client);
    if (guard) return guard;

    try {
      const symbol = params.symbol as string;
      const response = await client.listInstruments();
      const instrument = response.instruments.find((i) => i.symbol === symbol);

      if (!instrument) {
        return {
          content: `Instrument not found: ${symbol}`,
          isError: true,
        };
      }

      let md = `## ${instrument.symbol}\n\n`;
      md += `| Property | Value |\n`;
      md += `|----------|-------|\n`;
      md += `| Venue | ${instrument.venue} |\n`;
      md += `| Asset Class | ${instrument.assetClass} |\n`;
      md += `| Tick Size | ${instrument.tickSize} |\n`;
      md += `| Lot Size | ${instrument.lotSize} |\n`;
      md += `| Min Quantity | ${instrument.minQuantity} |\n`;
      md += `| Max Quantity | ${instrument.maxQuantity} |\n`;

      return { content: md.trim() };
    } catch (err) {
      return {
        content: `Instrument query failed: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }
  };

  return {
    definition: {
      name: "nautilus_get_instrument",
      description: "Get details for a specific instrument by symbol.",
      input_schema: {
        type: "object",
        properties: {
          symbol: { type: "string", description: "Instrument symbol (e.g. AAPL.XNAS)" },
        },
        required: ["symbol"],
      },
    },
    execute,
    requiresWallet: false,
  };
}

// ---------------------------------------------------------------------------
// 7. List Instruments
// ---------------------------------------------------------------------------

function createListInstruments(client: BridgeClient): ToolDescriptor {
  const execute: ToolExecuteFn = async () => {
    const guard = checkBridgeState(client);
    if (guard) return guard;

    try {
      const response = await client.listInstruments();

      if (response.instruments.length === 0) {
        return { content: "No instruments available." };
      }

      let md = "## Available Instruments\n\n";
      md += "| Symbol | Venue | Asset Class | Tick Size | Lot Size |\n";
      md += "|--------|-------|-------------|-----------|----------|\n";
      for (const inst of response.instruments) {
        md += `| ${inst.symbol} | ${inst.venue} | ${inst.assetClass} | ${inst.tickSize} | ${inst.lotSize} |\n`;
      }

      return { content: md.trim() };
    } catch (err) {
      return {
        content: `List instruments failed: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }
  };

  return {
    definition: {
      name: "nautilus_list_instruments",
      description: "List all available trading instruments with their specifications.",
      input_schema: {
        type: "object",
        properties: {},
        required: [],
      },
    },
    execute,
    requiresWallet: false,
  };
}

// ---------------------------------------------------------------------------
// 8. Subscribe Data
// ---------------------------------------------------------------------------

function createSubscribeData(client: BridgeClient): ToolDescriptor {
  const execute: ToolExecuteFn = async (params) => {
    const guard = checkBridgeState(client);
    if (guard) return guard;

    try {
      const symbol = params.symbol as string;
      const timeframe = params.timeframe as string;
      await client.subscribeBars(symbol, timeframe);
      return { content: `Subscribed to ${symbol} ${timeframe} bars` };
    } catch (err) {
      return {
        content: `Subscribe failed: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }
  };

  return {
    definition: {
      name: "nautilus_subscribe_data",
      description: "Subscribe to bar data for an instrument at a given timeframe.",
      input_schema: {
        type: "object",
        properties: {
          symbol: { type: "string", description: "Instrument symbol (e.g. AAPL.XNAS)" },
          timeframe: { type: "string", description: 'Bar timeframe (e.g. "1m", "5m", "1h")' },
        },
        required: ["symbol", "timeframe"],
      },
    },
    execute,
    requiresWallet: false,
  };
}

// ---------------------------------------------------------------------------
// 9. Unsubscribe Data
// ---------------------------------------------------------------------------

function createUnsubscribeData(client: BridgeClient): ToolDescriptor {
  const execute: ToolExecuteFn = async (params) => {
    const guard = checkBridgeState(client);
    if (guard) return guard;

    try {
      const symbol = params.symbol as string;
      const timeframe = params.timeframe as string;
      await client.unsubscribeBars(symbol, timeframe);
      return { content: `Unsubscribed from ${symbol} ${timeframe} bars` };
    } catch (err) {
      return {
        content: `Unsubscribe failed: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }
  };

  return {
    definition: {
      name: "nautilus_unsubscribe_data",
      description: "Unsubscribe from bar data for an instrument at a given timeframe.",
      input_schema: {
        type: "object",
        properties: {
          symbol: { type: "string", description: "Instrument symbol (e.g. AAPL.XNAS)" },
          timeframe: { type: "string", description: 'Bar timeframe (e.g. "1m", "5m", "1h")' },
        },
        required: ["symbol", "timeframe"],
      },
    },
    execute,
    requiresWallet: false,
  };
}

// ---------------------------------------------------------------------------
// 10. Emergency Halt
// ---------------------------------------------------------------------------

function createEmergencyHalt(client: BridgeClient): ToolDescriptor {
  const execute: ToolExecuteFn = async () => {
    const guard = checkBridgeState(client);
    if (guard) return guard;

    try {
      await client.emergencyHalt();
      return {
        content: "EMERGENCY HALT activated. All orders canceled, positions closing.",
      };
    } catch (err) {
      return {
        content: `Emergency halt failed: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }
  };

  return {
    definition: {
      name: "nautilus_emergency_halt",
      description:
        "Trigger an emergency halt of all trading. Cancels all open orders and closes all positions.",
      input_schema: {
        type: "object",
        properties: {},
        required: [],
      },
    },
    execute,
    requiresWallet: false,
  };
}

// ---------------------------------------------------------------------------
// 11. Set Instrument (hot-add)
// ---------------------------------------------------------------------------

function createSetInstrument(client: BridgeClient): ToolDescriptor {
  const execute: ToolExecuteFn = async (params) => {
    const guard = checkBridgeState(client);
    if (guard) return guard;

    try {
      const symbol = params.symbol as string;
      const response = await client.addInstrument(symbol, 25_000);
      const inst = response.instrument;
      const status = response.alreadyExisted ? "already loaded" : "newly added";

      let md = `## Instrument ${status}: ${inst.symbol}\n\n`;
      md += `| Property | Value |\n`;
      md += `|----------|-------|\n`;
      md += `| Status | ${status} |\n`;
      md += `| Venue | ${inst.venue} |\n`;
      md += `| Asset Class | ${inst.assetClass} |\n`;
      md += `| Tick Size | ${inst.tickSize} |\n`;
      md += `| Lot Size | ${inst.lotSize} |\n`;
      md += `| Min Quantity | ${inst.minQuantity} |\n`;
      md += `| Max Quantity | ${inst.maxQuantity} |\n`;

      return { content: md.trim() };
    } catch (err) {
      return {
        content: `Add instrument failed: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }
  };

  return {
    definition: {
      name: "nautilus_set_instrument",
      description:
        "Hot-add a trading instrument at runtime without restarting the bridge. " +
        "Resolves the symbol from the venue, loads it into the NautilusTrader cache, " +
        "subscribes to quote ticks, and persists to config for restart survival. " +
        "Resolution takes 5-20 seconds for new instruments. " +
        "Returns immediately if the instrument is already loaded. " +
        "Symbol format: SYMBOL.EXCHANGE (e.g. NVDA.NASDAQ, NQM6.CME, MSFT.XNAS).",
      input_schema: {
        type: "object",
        properties: {
          symbol: {
            type: "string",
            description: "Instrument symbol in SYMBOL.EXCHANGE format (e.g. NVDA.NASDAQ, ESH6.CME)",
          },
        },
        required: ["symbol"],
      },
    },
    execute,
    requiresWallet: false,
  };
}
