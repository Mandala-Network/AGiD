/**
 * Consumer-facing BridgeClient -- single entry point for the AGiD-NautilusBridge protocol.
 *
 * Composes ConnectionManager, PortfolioCache, MarketDataCache, and BackpressureMonitor
 * into a cohesive async API with typed event emissions and read-only cache accessors.
 *
 * Usage:
 *   const client = new BridgeClient({ url: 'ws://...', privateKey });
 *   await client.connect();
 *   client.on('orderUpdate', (evt) => { ... });
 *   const order = await client.submitOrder({ symbol: 'AAPL', ... });
 *   console.log(client.portfolio.positions);
 */

import { EventEmitter } from "node:events";

import { ConnectionManager } from "./connection-manager.js";
import { PortfolioCache } from "./portfolio-cache.js";
import type { AccountState, PositionState, OrderState } from "./portfolio-cache.js";
import { MarketDataCache } from "./market-data-cache.js";
import { BackpressureMonitor } from "./backpressure.js";
import type { BackpressureConfig } from "./backpressure.js";
import {
  ConnectionState,
} from "./types.js";
import type {
  AddInstrumentResponse,
  BridgeClientConfig,
  OrderEvent,
  PositionEvent,
  DataBarEvent,
  QuoteTickEvent,
  PortfolioResponse,
  ListInstrumentsResponse,
  HaltResponse,
  GetQuoteResponse,
} from "./types.js";

/** Latest quote tick data for an instrument. */
export interface LatestQuote {
  instrumentId: string;
  bidPrice: string;
  askPrice: string;
  bidSize: string;
  askSize: string;
  ts: number;
}

// ---------------------------------------------------------------------------
// BridgeClient
// ---------------------------------------------------------------------------

export class BridgeClient extends EventEmitter {
  private readonly _connectionManager: ConnectionManager;
  private readonly _portfolioCache: PortfolioCache;
  private readonly _marketDataCache: MarketDataCache;
  private readonly _backpressureMonitor: BackpressureMonitor;

  /** Per-subscription sequence number tracking for gap detection. */
  private readonly _lastSeqBySubscription = new Map<string, number>();

  /** Tracks active bar subscriptions for re-subscription on reconnect. */
  private readonly _barSubscriptions = new Set<string>();

  /** Latest quote tick per instrument. */
  private readonly _latestQuotes = new Map<string, LatestQuote>();

  /** Promise resolvers for connect() lifecycle. */
  private _connectResolve: (() => void) | null = null;
  private _connectReject: ((err: Error) => void) | null = null;

  /** Backpressure config (optional, for testing with low thresholds). */
  private readonly _backpressureConfig: Partial<BackpressureConfig> | undefined;

  constructor(config: BridgeClientConfig) {
    super();

    // Apply defaults and build internal config
    const fullConfig: BridgeClientConfig = {
      url: config.url ?? "ws://127.0.0.1:9500",
      privateKey: config.privateKey,
      commandTimeout: config.commandTimeout ?? 10_000,
      reconnect: {
        enabled: config.reconnect?.enabled ?? true,
        maxDelay: config.reconnect?.maxDelay ?? 15_000,
        backoffDelays: config.reconnect?.backoffDelays ?? [0, 1000, 2000, 4000, 8000],
      },
      heartbeatTimeout: config.heartbeatTimeout,
      marketData: {
        ringBufferSize: config.marketData?.ringBufferSize ?? 50,
      },
      commandQueueMax: config.commandQueueMax ?? 100,
    };

    // Store backpressure config for monitor creation
    this._backpressureConfig = (config as BridgeClientConfig & { backpressure?: Partial<BackpressureConfig> }).backpressure;

    // Create composed modules
    this._connectionManager = new ConnectionManager(fullConfig);
    this._portfolioCache = new PortfolioCache();
    this._marketDataCache = new MarketDataCache(fullConfig.marketData!.ringBufferSize);
    this._backpressureMonitor = new BackpressureMonitor(this._backpressureConfig);

    // Wire up event forwarding
    this.wireConnectionEvents();
    this.wireDataEvents();
  }

  // ---------------------------------------------------------------------------
  // Public read-only properties
  // ---------------------------------------------------------------------------

  /** Current connection state. */
  get state(): ConnectionState {
    return this._connectionManager.state;
  }

  /** Portfolio cache accessors (accounts, positions, open orders). */
  get portfolio(): {
    readonly accounts: ReadonlyMap<string, AccountState>;
    readonly positions: ReadonlyMap<string, PositionState>;
    readonly orders: ReadonlyMap<string, OrderState>;
  } {
    return {
      accounts: this._portfolioCache.accounts,
      positions: this._portfolioCache.positions,
      orders: this._portfolioCache.orders,
    };
  }

  /** Market data cache accessors. */
  get marketData(): {
    getBars(instrumentId: string, timeframe: string): DataBarEvent[];
    getLatestBar(instrumentId: string, timeframe: string): DataBarEvent | undefined;
    getTrackedInstruments(): Array<{ instrumentId: string; timeframe: string }>;
    getLatestQuote(instrumentId: string): LatestQuote | undefined;
    getAllQuotes(): ReadonlyMap<string, LatestQuote>;
  } {
    return {
      getBars: (instrumentId: string, timeframe: string) =>
        this._marketDataCache.getBars(instrumentId, timeframe),
      getLatestBar: (instrumentId: string, timeframe: string) =>
        this._marketDataCache.getLatestBar(instrumentId, timeframe),
      getTrackedInstruments: () =>
        this._marketDataCache.getTrackedInstruments(),
      getLatestQuote: (instrumentId: string) =>
        this._latestQuotes.get(instrumentId),
      getAllQuotes: () => this._latestQuotes,
    };
  }

  // ---------------------------------------------------------------------------
  // Lifecycle methods
  // ---------------------------------------------------------------------------

  /**
   * Connect to the bridge. Returns a Promise that resolves when READY state is
   * reached or rejects on auth failure / connection error.
   */
  async connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this._connectResolve = resolve;
      this._connectReject = reject;

      try {
        this._connectionManager.connect();
      } catch (err) {
        this._connectResolve = null;
        this._connectReject = null;
        reject(err as Error);
      }
    });
  }

  /**
   * Gracefully disconnect from the bridge. Clears all caches.
   */
  async disconnect(): Promise<void> {
    this._connectionManager.disconnect();
    this._marketDataCache.clear();
    this._lastSeqBySubscription.clear();
    this._backpressureMonitor.resetAll();

    // Resolve any pending connect promise
    if (this._connectReject) {
      this._connectReject(new Error("Manual disconnect"));
      this._connectResolve = null;
      this._connectReject = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Command methods (all async)
  // ---------------------------------------------------------------------------

  /**
   * Submit an order to the bridge.
   */
  async submitOrder(params: {
    symbol: string;
    orderSide: string;
    orderType: string;
    quantity: string;
    price?: string;
    triggerPrice?: string;
    timeInForce?: string;
    postOnly?: boolean;
    clientOrderId?: string;
  }): Promise<OrderEvent> {
    return this._connectionManager.sendCommand<OrderEvent>("submit_order", params);
  }

  /**
   * Cancel an open order.
   */
  async cancelOrder(clientOrderId: string): Promise<OrderEvent> {
    return this._connectionManager.sendCommand<OrderEvent>("cancel_order", {
      clientOrderId,
    });
  }

  /**
   * Modify an existing order.
   */
  async modifyOrder(params: {
    clientOrderId: string;
    quantity?: string;
    price?: string;
    triggerPrice?: string;
  }): Promise<OrderEvent> {
    return this._connectionManager.sendCommand<OrderEvent>("modify_order", params);
  }

  /**
   * Request a full portfolio snapshot.
   */
  async getPortfolio(): Promise<PortfolioResponse> {
    return this._connectionManager.sendCommand<PortfolioResponse>("get_portfolio", {});
  }

  /**
   * List available instruments.
   */
  async listInstruments(): Promise<ListInstrumentsResponse> {
    return this._connectionManager.sendCommand<ListInstrumentsResponse>(
      "list_instruments",
      {},
    );
  }

  /**
   * Hot-add an instrument at runtime. The bridge resolves the symbol via the
   * venue adapter, loads it into the NautilusTrader cache, subscribes to quote
   * ticks, and persists it to .env for restart survival.
   *
   * Uses a 25s timeout since instrument resolution requires a venue round-trip.
   */
  async addInstrument(symbol: string, timeoutMs = 25_000): Promise<AddInstrumentResponse> {
    return this._connectionManager.sendCommand<AddInstrumentResponse>(
      "add_instrument",
      { symbol },
      timeoutMs,
    );
  }

  async getQuote(symbols: string[]): Promise<GetQuoteResponse> {
    return this._connectionManager.sendCommand<GetQuoteResponse>(
      "get_quote",
      { symbols },
    );
  }

  /**
   * Trigger an emergency halt of all trading.
   */
  async emergencyHalt(params?: {
    reason?: string;
    cancelOrders?: boolean;
    closePositions?: boolean;
  }): Promise<HaltResponse> {
    return this._connectionManager.sendCommand<HaltResponse>(
      "emergency_halt",
      params ?? {},
    );
  }

  /**
   * Resume trading after a halt.
   */
  async resumeTrading(reason?: string): Promise<unknown> {
    return this._connectionManager.sendCommand<unknown>("resume_trading", {
      reason: reason ?? undefined,
    });
  }

  /**
   * Subscribe to bar data for an instrument/timeframe.
   */
  async subscribeBars(instrumentId: string, timeframe: string): Promise<void> {
    const subKey = `${instrumentId}:${timeframe}`;
    this._barSubscriptions.add(subKey);
    this._connectionManager.registerSubscription("subscribe_bars", instrumentId, timeframe);
    await this._connectionManager.sendCommand<unknown>("subscribe_bars", {
      instrumentId,
      timeframe,
    });
  }

  /**
   * Unsubscribe from bar data for an instrument/timeframe.
   */
  async unsubscribeBars(instrumentId: string, timeframe: string): Promise<void> {
    const subKey = `${instrumentId}:${timeframe}`;
    this._barSubscriptions.delete(subKey);
    this._connectionManager.unregisterSubscription("subscribe_bars", instrumentId, timeframe);
    this._marketDataCache.clearSubscription(instrumentId, timeframe);
    this._backpressureMonitor.resetSubscription(subKey);
    this._lastSeqBySubscription.delete(subKey);
    await this._connectionManager.sendCommand<unknown>("unsubscribe_bars", {
      instrumentId,
      timeframe,
    });
  }

  // ---------------------------------------------------------------------------
  // Generic strategy command dispatch
  // ---------------------------------------------------------------------------

  /**
   * Send a generic command to the bridge and await a correlated response.
   *
   * Used by strategy tools for commands that do not have dedicated typed
   * methods on BridgeClient (create_strategy, backtest_strategy, etc.).
   *
   * @param type - The protocol message type string
   * @param params - The command parameters (excluding type, id, ts, version)
   * @param timeoutMs - Optional per-command timeout override in ms
   * @returns The bridge response, typed as T
   */
  async sendCommand<T>(type: string, params: Record<string, unknown>, timeoutMs?: number): Promise<T> {
    return this._connectionManager.sendCommand<T>(type, params, timeoutMs);
  }

  // ---------------------------------------------------------------------------
  // Event wiring: ConnectionManager lifecycle -> BridgeClient
  // ---------------------------------------------------------------------------

  private wireConnectionEvents(): void {
    const cm = this._connectionManager;

    // 1. stateChange -> forward
    cm.on("stateChange", (data: { from: ConnectionState; to: ConnectionState }) => {
      this.emit("stateChange", data);
    });

    // 2. authenticated -> forward
    cm.on("authenticated", (data: unknown) => {
      this.emit("authenticated", data);
    });

    // 3. synchronizing -> trigger portfolio sync
    cm.on("synchronizing", () => {
      this.performSync().catch((err) => {
        this.emit("error", err);
      });
    });

    // 4. ready -> emit syncComplete, then ready, and resolve connect promise
    cm.on("ready", () => {
      this.emit("syncComplete");
      this.emit("ready");

      // Re-subscribe to bars after reconnect
      this.resubscribeBars().catch((err) => {
        this.emit("error", err);
      });

      // Resolve the connect() promise
      if (this._connectResolve) {
        this._connectResolve();
        this._connectResolve = null;
        this._connectReject = null;
      }
    });

    // 5. reconnecting -> forward
    cm.on("reconnecting", (data: { attempt: number; delay: number }) => {
      this.emit("reconnecting", data);
    });

    // 6. reconnected -> forward
    cm.on("reconnected", () => {
      this.emit("reconnected");
    });

    // 7. authFailed -> forward and reject connect promise
    cm.on("authFailed", (data: { reason: string }) => {
      this.emit("authFailed", data);

      if (this._connectReject) {
        this._connectReject(new Error(`Authentication failed: ${data.reason}`));
        this._connectResolve = null;
        this._connectReject = null;
      }
    });

    // 8. disconnected -> forward, clear market data (keep portfolio for stale reads)
    cm.on("disconnected", (data: { reason: string; code?: number }) => {
      this.emit("disconnected", data);
      this._marketDataCache.clear();
      this._lastSeqBySubscription.clear();
      this._backpressureMonitor.resetAll();
    });

    // 9. commandTimeout -> forward
    cm.on("commandTimeout", (data: { commandId: string; type: string }) => {
      this.emit("commandTimeout", data);
    });

    // 10. health -> forward
    cm.on("health", (data: unknown) => {
      this.emit("health", data);
    });
  }

  // ---------------------------------------------------------------------------
  // Event wiring: ConnectionManager data events -> caches -> BridgeClient
  // ---------------------------------------------------------------------------

  private wireDataEvents(): void {
    const cm = this._connectionManager;

    // evt_order -> unwrap payload -> portfolio cache + emit orderUpdate
    cm.on("orderEvent", (rawEvent: Record<string, unknown>) => {
      // Bridge wraps event fields inside "payload"; unwrap to match OrderEvent shape.
      const payload = (rawEvent.payload ?? rawEvent) as Record<string, unknown>;
      const event: OrderEvent = {
        type: "evt_order",
        id: rawEvent.id as string,
        ts: rawEvent.ts as number,
        version: rawEvent.version as string,
        seq: rawEvent.seq as number,
        correlationId: (rawEvent.correlationId as string) ?? null,
        eventType: payload.eventType as string,
        clientOrderId: payload.clientOrderId as string,
        instrumentId: payload.instrumentId as string,
        venueOrderId: (payload.venueOrderId as string) ?? null,
        orderSide: payload.orderSide as string,
        orderType: payload.orderType as string,
        quantity: payload.quantity as string,
        filledQty: payload.filledQty as string,
        avgPrice: (payload.avgPrice as string) ?? null,
        status: payload.status as string,
        tsEvent: payload.tsEvent as number,
        reason: (payload.reason as string) ?? null,
      };
      this._portfolioCache.applyOrderEvent(event);
      this.emit("orderUpdate", event);
    });

    // evt_position -> unwrap payload -> portfolio cache + emit positionUpdate
    cm.on("positionEvent", (rawEvent: Record<string, unknown>) => {
      const payload = (rawEvent.payload ?? rawEvent) as Record<string, unknown>;
      const event: PositionEvent = {
        type: "evt_position",
        id: rawEvent.id as string,
        ts: rawEvent.ts as number,
        version: rawEvent.version as string,
        seq: rawEvent.seq as number,
        correlationId: (rawEvent.correlationId as string) ?? null,
        eventType: payload.eventType as string,
        positionId: payload.positionId as string,
        instrumentId: payload.instrumentId as string,
        side: payload.side as string,
        quantity: payload.quantity as string,
        avgOpenPrice: payload.avgOpenPrice as string,
        unrealizedPnl: payload.unrealizedPnl as string,
        realizedPnl: payload.realizedPnl as string,
        currentPrice: (payload.currentPrice as string) ?? null,
        entryPrice: payload.entryPrice as string,
        tsEvent: payload.tsEvent as number,
      };
      this._portfolioCache.applyPositionEvent(event);
      this.emit("positionUpdate", event);
    });

    // evt_quote_tick -> latest quote cache + emit quoteTick
    cm.on("quoteTick", (event: QuoteTickEvent) => {
      const payload = event.payload;
      this._latestQuotes.set(payload.instrumentId, {
        instrumentId: payload.instrumentId,
        bidPrice: payload.bidPrice,
        askPrice: payload.askPrice,
        bidSize: payload.bidSize,
        askSize: payload.askSize,
        ts: payload.ts,
      });
      this.emit("quoteTick", payload);
    });

    // data_bar -> backpressure check + sequence gap detection + cache + emit bar
    cm.on("dataBar", (event: DataBarEvent) => {
      const subKey = `${event.instrumentId}:${event.timeframe}`;

      // Backpressure check
      const { action, event: bpEvent } =
        this._backpressureMonitor.recordMessage(subKey);

      // Emit backpressure event if stage changed
      if (bpEvent) {
        this.emit("backpressure", bpEvent);
      }

      switch (action) {
        case "process": {
          // Sequence gap detection
          const lastSeq = this._lastSeqBySubscription.get(subKey);
          if (lastSeq !== undefined && event.seq > lastSeq + 1) {
            this.emit("dataGap", {
              subscription: subKey,
              fromSeq: lastSeq + 1,
              toSeq: event.seq - 1,
            });
          }
          this._lastSeqBySubscription.set(subKey, event.seq);

          // Apply to cache and emit
          this._marketDataCache.applyBar(event);
          this.emit("bar", event);
          break;
        }

        case "drop":
          // Do not process or emit
          break;

        case "disconnect":
          // Trigger disconnect + reconnect with reason
          this._connectionManager.disconnect();
          break;
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Portfolio sync during SYNCHRONIZING state
  // ---------------------------------------------------------------------------

  /**
   * Perform portfolio synchronization during SYNCHRONIZING state.
   * Sends get_portfolio, populates cache from snapshot, flushes sync buffer.
   */
  private async performSync(): Promise<void> {
    try {
      const response = await this._connectionManager.sendCommand<PortfolioResponse>(
        "get_portfolio",
        {},
      );

      // Replace cache from snapshot
      const counts = this._portfolioCache.replaceFromSnapshot(response);
      this.emit("snapshotSync", counts);

      // Flush buffered events that arrived during sync
      const bufferedEvents = this._connectionManager.flushSyncBuffer();
      for (const evt of bufferedEvents) {
        const evtMsg = evt as Record<string, unknown>;
        const evtType = evtMsg.type as string;

        if (evtType === "evt_order") {
          this._portfolioCache.applyOrderEvent(evtMsg as unknown as OrderEvent);
          this.emit("orderUpdate", evtMsg);
        } else if (evtType === "evt_position") {
          this._portfolioCache.applyPositionEvent(evtMsg as unknown as PositionEvent);
          this.emit("positionUpdate", evtMsg);
        } else if (evtType === "data_bar") {
          this._marketDataCache.applyBar(evtMsg as unknown as DataBarEvent);
          this.emit("bar", evtMsg);
        }
      }
    } catch (err) {
      // Sync failure -- emit error but do not block READY transition
      // (bridge_ready from the server will still transition to READY)
      this.emit("error", err);
    }
  }

  // ---------------------------------------------------------------------------
  // Re-subscribe bars after reconnect
  // ---------------------------------------------------------------------------

  private async resubscribeBars(): Promise<void> {
    for (const subKey of this._barSubscriptions) {
      const separatorIdx = subKey.indexOf(":");
      const instrumentId = subKey.slice(0, separatorIdx);
      const timeframe = subKey.slice(separatorIdx + 1);

      try {
        await this._connectionManager.sendCommand<unknown>("subscribe_bars", {
          instrumentId,
          timeframe,
        });
      } catch (err) {
        this.emit("error", err);
      }
    }
  }
}
