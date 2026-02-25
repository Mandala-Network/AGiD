/**
 * Local mirror of the bridge's portfolio state.
 *
 * Maintains accounts, positions, and open orders in Maps with two
 * update paths:
 *   1. Atomic snapshot replacement (on connect / reconnect when
 *      portfolio_response arrives during SYNCHRONIZING)
 *   2. Incremental event updates (order and position events during
 *      READY state)
 *
 * All financial values remain as decimal strings -- no Number
 * conversion. ReadonlyMap accessors prevent external mutation.
 */

import type {
  OrderEvent,
  PositionEvent,
  PortfolioResponse,
} from "./types.js";

// ---------------------------------------------------------------------------
// State interfaces
// ---------------------------------------------------------------------------

export interface AccountState {
  accountId: string;
  [key: string]: unknown;
}

export interface PositionState {
  positionId: string;
  instrumentId: string;
  side: string;
  quantity: string;
  avgOpenPrice: string;
  unrealizedPnl: string;
  realizedPnl: string;
  entryPrice: string;
  currentPrice?: string;
  [key: string]: unknown;
}

export interface OrderState {
  clientOrderId: string;
  instrumentId: string;
  orderSide: string;
  orderType: string;
  quantity: string;
  filledQty: string;
  avgPrice?: string;
  status: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Terminal order statuses that cause removal from the open orders map
// ---------------------------------------------------------------------------

const TERMINAL_ORDER_STATUSES = new Set([
  "CANCELED",
  "EXPIRED",
  "REJECTED",
  "DENIED",
]);

// ---------------------------------------------------------------------------
// PortfolioCache
// ---------------------------------------------------------------------------

export class PortfolioCache {
  private _accounts = new Map<string, AccountState>();
  private _positions = new Map<string, PositionState>();
  private _openOrders = new Map<string, OrderState>();

  // -----------------------------------------------------------------------
  // Read-only accessors
  // -----------------------------------------------------------------------

  get accounts(): ReadonlyMap<string, AccountState> {
    return this._accounts;
  }

  get positions(): ReadonlyMap<string, PositionState> {
    return this._positions;
  }

  get orders(): ReadonlyMap<string, OrderState> {
    return this._openOrders;
  }

  // -----------------------------------------------------------------------
  // Atomic snapshot replacement (CLIENT-03)
  // -----------------------------------------------------------------------

  /**
   * Replace the entire portfolio cache from a bridge snapshot.
   * Called during SYNCHRONIZING when portfolio_response arrives.
   *
   * Clears all maps first, then populates from the response. This is
   * atomic: all maps are cleared before any population begins.
   *
   * Returns counts for the snapshotSync event.
   */
  replaceFromSnapshot(response: PortfolioResponse): {
    accounts: number;
    positions: number;
    orders: number;
  } {
    // Step 1: Clear all maps atomically
    this._accounts.clear();
    this._positions.clear();
    this._openOrders.clear();

    // Step 2: Populate accounts
    for (const acct of response.accounts) {
      const accountId = acct["accountId"] as string | undefined;
      if (accountId) {
        this._accounts.set(accountId, { ...acct, accountId } as AccountState);
      }
    }

    // Step 3: Populate positions
    for (const pos of response.positions) {
      const positionId = pos["positionId"] as string | undefined;
      if (positionId) {
        this._positions.set(positionId, {
          ...pos,
          positionId,
        } as PositionState);
      }
    }

    // Step 4: Populate open orders
    for (const ord of response.openOrders) {
      const clientOrderId = ord["clientOrderId"] as string | undefined;
      if (clientOrderId) {
        this._openOrders.set(clientOrderId, {
          ...ord,
          clientOrderId,
        } as OrderState);
      }
    }

    return {
      accounts: this._accounts.size,
      positions: this._positions.size,
      orders: this._openOrders.size,
    };
  }

  // -----------------------------------------------------------------------
  // Incremental event updates (CLIENT-04)
  // -----------------------------------------------------------------------

  /**
   * Apply an order event to the open orders cache.
   *
   * Terminal statuses (FILLED with filledQty >= quantity, CANCELED,
   * EXPIRED, REJECTED, DENIED) remove the order from the map.
   * Active statuses upsert the order.
   */
  applyOrderEvent(event: OrderEvent): void {
    const isTerminal =
      TERMINAL_ORDER_STATUSES.has(event.status) ||
      (event.status === "FILLED" && event.filledQty >= event.quantity);

    if (isTerminal) {
      this._openOrders.delete(event.clientOrderId);
      return;
    }

    // Active status -- upsert
    this._openOrders.set(event.clientOrderId, {
      clientOrderId: event.clientOrderId,
      instrumentId: event.instrumentId,
      orderSide: event.orderSide,
      orderType: event.orderType,
      quantity: event.quantity,
      filledQty: event.filledQty,
      avgPrice: event.avgPrice ?? undefined,
      status: event.status,
    });
  }

  /**
   * Apply a position event to the positions cache.
   *
   * OPENED/CHANGED: upsert position by positionId with all fields.
   * CLOSED: remove position by positionId.
   */
  applyPositionEvent(event: PositionEvent): void {
    if (event.eventType === "CLOSED") {
      this._positions.delete(event.positionId);
      return;
    }

    // OPENED or CHANGED -- upsert
    this._positions.set(event.positionId, {
      positionId: event.positionId,
      instrumentId: event.instrumentId,
      side: event.side,
      quantity: event.quantity,
      avgOpenPrice: event.avgOpenPrice,
      unrealizedPnl: event.unrealizedPnl,
      realizedPnl: event.realizedPnl,
      entryPrice: event.entryPrice,
      currentPrice: event.currentPrice ?? undefined,
    });
  }

  /**
   * Apply an account event to the accounts cache.
   *
   * Account events are not yet emitted by the bridge, but the handler
   * is prepared. If the event has an accountId, upsert into accounts.
   */
  applyAccountEvent(event: Record<string, unknown>): void {
    const accountId = event["accountId"] as string | undefined;
    if (accountId) {
      this._accounts.set(accountId, { ...event, accountId } as AccountState);
    }
  }

  // -----------------------------------------------------------------------
  // Utilities
  // -----------------------------------------------------------------------

  /**
   * Clear all caches (e.g. on disconnect).
   */
  clear(): void {
    this._accounts.clear();
    this._positions.clear();
    this._openOrders.clear();
  }

  /**
   * Summary counts for logging.
   */
  summary(): { accounts: number; positions: number; orders: number } {
    return {
      accounts: this._accounts.size,
      positions: this._positions.size,
      orders: this._openOrders.size,
    };
  }
}
