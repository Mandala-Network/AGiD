/**
 * ConnectionManager -- WebSocket connection lifecycle for the AGiD-NautilusBridge protocol.
 *
 * Handles the complete 6-state connection machine (DISCONNECTED -> CONNECTING ->
 * AUTHENTICATING -> CONNECTED -> SYNCHRONIZING -> READY), BSV ECDSA authentication,
 * application-level heartbeat pong responses, command/response correlation via UUID
 * with configurable timeout, command queue during non-READY states, and automatic
 * reconnection with exponential backoff.
 *
 * Extends Node.js EventEmitter for lifecycle events.
 */

import WebSocket from "ws";
import { PrivateKey } from "@bsv/sdk";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";

import {
  ConnectionState,
  CONNECTION_TRANSITIONS,
  PROTOCOL_VERSION,
  TimeoutError,
} from "./types.js";
import type { BridgeClientConfig } from "./types.js";

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/** A pending command awaiting a correlated response from the bridge. */
interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  type: string;
}

/** A queued command awaiting READY state to be sent. */
interface QueuedCommand {
  payload: string;
  id: string;
}

// ---------------------------------------------------------------------------
// Default configuration values
// ---------------------------------------------------------------------------

const DEFAULT_URL = "ws://127.0.0.1:9500";
const DEFAULT_COMMAND_TIMEOUT_MS = 10_000;
const DEFAULT_HEARTBEAT_TIMEOUT = 3;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 10_000;
const DEFAULT_COMMAND_QUEUE_MAX = 100;
const DEFAULT_BACKOFF_DELAYS = [0, 1000, 2000, 4000, 8000];
const DEFAULT_MAX_RECONNECT_DELAY = 15_000;
const SUBPROTOCOL = "agid-nautilus-v1";

// ---------------------------------------------------------------------------
// ConnectionManager
// ---------------------------------------------------------------------------

/**
 * Manages the WebSocket connection to the NautilusBridge.
 *
 * Emits the following events:
 * - `stateChange`     { from: ConnectionState, to: ConnectionState }
 * - `authenticated`   { agentId: string, venue: string, mode: string, instruments: string[] }
 * - `synchronizing`   void
 * - `ready`           void
 * - `authFailed`      { reason: string }
 * - `disconnected`    { reason: string, code?: number }
 * - `disconnecting`   { reason: string }
 * - `reconnecting`    { attempt: number, delay: number }
 * - `reconnected`     void
 * - `health`          BridgeHealth message object
 * - `pong`            { seq: number, latencyMs: number }
 * - `commandTimeout`  { commandId: string, type: string }
 * - `error`           Error
 * - `message`         unknown -- raw parsed message (for unhandled types)
 * - `orderEvent`      OrderEvent message
 * - `positionEvent`   PositionEvent message
 * - `dataBar`         DataBarEvent message
 */
export class ConnectionManager extends EventEmitter {
  // -- Configuration --
  private readonly _url: string;
  private readonly _privateKey: PrivateKey;
  private readonly _commandTimeoutMs: number;
  private readonly _heartbeatTimeout: number;
  private readonly _commandQueueMax: number;
  private readonly _reconnectEnabled: boolean;
  private readonly _backoffDelays: number[];
  private readonly _maxReconnectDelay: number;

  // -- State machine --
  private _state: ConnectionState = ConnectionState.DISCONNECTED;

  // -- WebSocket --
  private _ws: WebSocket | null = null;

  // -- Command correlation --
  private readonly _pendingRequests: Map<string, PendingRequest> = new Map();

  // -- Command queue --
  private _commandQueue: QueuedCommand[] = [];

  // -- Heartbeat --
  private _heartbeatTimer: ReturnType<typeof setTimeout> | null = null;

  // -- Reconnection --
  private _reconnectAttempt: number = 0;
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _authFailed: boolean = false;
  private _manualDisconnect: boolean = false;
  private _wasReconnecting: boolean = false;

  // -- Subscription registry --
  private readonly _activeSubscriptions: Set<string> = new Set();

  // -- Sync event buffer --
  private _syncBuffering: boolean = false;
  private _syncEventBuffer: Array<unknown> = [];

  // -- Venue info from auth --
  private _venueInfo: {
    agentId: string;
    venue: string;
    mode: string;
    instruments: string[];
  } | null = null;

  constructor(config: BridgeClientConfig) {
    super();
    this._url = config.url ?? DEFAULT_URL;
    this._privateKey = config.privateKey;
    this._commandTimeoutMs = config.commandTimeout ?? DEFAULT_COMMAND_TIMEOUT_MS;
    this._heartbeatTimeout = config.heartbeatTimeout ?? DEFAULT_HEARTBEAT_TIMEOUT;
    this._commandQueueMax = config.commandQueueMax ?? DEFAULT_COMMAND_QUEUE_MAX;
    this._reconnectEnabled = config.reconnect?.enabled ?? true;
    this._backoffDelays =
      config.reconnect?.backoffDelays ?? DEFAULT_BACKOFF_DELAYS;
    this._maxReconnectDelay =
      config.reconnect?.maxDelay ?? DEFAULT_MAX_RECONNECT_DELAY;
  }

  // ---------------------------------------------------------------------------
  // Public accessors
  // ---------------------------------------------------------------------------

  /** Current connection state (read-only). */
  get state(): ConnectionState {
    return this._state;
  }

  /** Venue information from the last successful authentication. */
  get venueInfo(): Readonly<{
    agentId: string;
    venue: string;
    mode: string;
    instruments: string[];
  }> | null {
    return this._venueInfo;
  }

  // ---------------------------------------------------------------------------
  // State machine
  // ---------------------------------------------------------------------------

  /**
   * Transition to a new connection state.
   * Validates the transition against CONNECTION_TRANSITIONS and emits 'stateChange'.
   */
  private transition(to: ConnectionState): void {
    const validTargets = CONNECTION_TRANSITIONS[this._state];
    if (!validTargets.has(to)) {
      throw new Error(
        `Invalid state transition: ${this._state} -> ${to}. ` +
          `Valid targets from ${this._state}: [${[...validTargets].join(", ")}]`,
      );
    }
    const from = this._state;
    this._state = to;
    this.emit("stateChange", { from, to });
  }

  // ---------------------------------------------------------------------------
  // connect / disconnect
  // ---------------------------------------------------------------------------

  /** Open a WebSocket connection and begin the auth handshake. */
  connect(): void {
    if (this._state !== ConnectionState.DISCONNECTED) {
      throw new Error(
        `Cannot connect from state ${this._state}; must be DISCONNECTED`,
      );
    }

    this._manualDisconnect = false;
    this._authFailed = false;
    this._wasReconnecting = this._reconnectAttempt > 0;

    this.transition(ConnectionState.CONNECTING);

    const ws = new WebSocket(this._url, [SUBPROTOCOL], {
      perMessageDeflate: false,
      handshakeTimeout: 10_000,
    });

    this._ws = ws;

    ws.on("open", () => {
      this.transition(ConnectionState.AUTHENTICATING);
    });

    ws.on("message", (data: WebSocket.Data) => {
      this.onMessage(data);
    });

    ws.on("close", (code: number, reason: Buffer) => {
      this.onClose(code, reason.toString("utf-8"));
    });

    ws.on("error", (err: Error) => {
      this.emit("error", err);
    });
  }

  /** Gracefully disconnect from the bridge. */
  disconnect(): void {
    this._manualDisconnect = true;

    // Clear reconnect timer
    if (this._reconnectTimer !== null) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }

    // Clear heartbeat timer
    this.clearHeartbeatTimer();

    // Reject all pending requests (includes queued commands' pending entries)
    for (const [, req] of this._pendingRequests) {
      clearTimeout(req.timer);
      req.reject(new Error("Connection closed"));
    }
    this._pendingRequests.clear();

    // Clear command queue
    this._commandQueue = [];

    // Close WebSocket
    if (this._ws !== null) {
      try {
        this._ws.close(1000, "manual disconnect");
      } catch {
        // Ignore close errors on already-closed sockets
      }
      this._ws = null;
    }

    // Transition to DISCONNECTED if not already
    if (this._state !== ConnectionState.DISCONNECTED) {
      this.transition(ConnectionState.DISCONNECTED);
    }

    this.emit("disconnected", { reason: "manual" });
  }

  // ---------------------------------------------------------------------------
  // Message router
  // ---------------------------------------------------------------------------

  private onMessage(data: WebSocket.Data): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(data.toString()) as Record<string, unknown>;
    } catch {
      this.emit("error", new Error("Failed to parse bridge message as JSON"));
      return;
    }

    const msgType = msg.type as string;

    // Log all non-tick messages for diagnostic visibility
    if (msgType !== "evt_quote_tick" && msgType !== "bridge_ping") {
      console.log(
        `[ConnectionManager] RECV type=${msgType} correlationId=${(msg.correlationId as string) ?? "none"}`,
      );
    }

    switch (msgType) {
      case "bridge_hello":
        this.handleBridgeHello(msg);
        break;

      case "bridge_auth_ok":
        this.handleAuthOk(msg);
        break;

      case "auth_failed":
        this.handleAuthFailed(msg);
        break;

      case "bridge_ready":
        this.handleBridgeReady();
        break;

      case "bridge_ping":
        this.handlePing(msg);
        break;

      case "bridge_health":
        this.emit("health", msg);
        break;

      case "err_response":
        this.handleErrResponse(msg);
        break;

      case "portfolio_response":
      case "halt_response":
      case "list_instruments_response":
      case "subscribe_bars_ack":
      case "submit_order_ack":
      case "cancel_order_ack":
      case "modify_order_ack":
      case "create_strategy_response":
      case "backtest_result":
      case "optimize_result":
      case "deploy_result":
      case "monitor_result":
      case "pause_result":
        this.resolveCommand(msg.correlationId as string, msg);
        break;

      case "evt_quote_tick":
        this.emit("quoteTick", msg);
        break;

      case "evt_order":
        if (this._syncBuffering) {
          this._syncEventBuffer.push(msg);
        } else {
          this.emit("orderEvent", msg);
        }
        break;

      case "evt_position":
        if (this._syncBuffering) {
          this._syncEventBuffer.push(msg);
        } else {
          this.emit("positionEvent", msg);
        }
        break;

      case "data_bar":
        if (this._syncBuffering) {
          this._syncEventBuffer.push(msg);
        } else {
          this.emit("dataBar", msg);
        }
        break;

      case "bridge_disconnecting":
        this.emit("disconnecting", { reason: (msg.reason as string) ?? "" });
        break;

      default:
        this.emit("message", msg);
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // Auth flow handlers
  // ---------------------------------------------------------------------------

  /**
   * Handle bridge_hello: sign the nonce challenge with BSV ECDSA and send bridge_auth.
   *
   * The Python bridge reconstructs `f"{nonce}:{timestamp}".encode("utf-8")` and calls
   * `pubkey.verify(sig, msg, sha256)`. PrivateKey.sign() in @bsv/sdk applies SHA-256
   * internally, so we pass the raw message string -- NO pre-hashing.
   */
  private handleBridgeHello(msg: Record<string, unknown>): void {
    const nonce = msg.nonce as string;
    const timestamp = Date.now() * 1_000_000; // nanoseconds
    const message = `${nonce}:${timestamp}`;

    // Sign raw message -- PrivateKey.sign() applies SHA-256 internally
    const signature = this._privateKey.sign(message);
    const signatureHex = signature.toDER("hex") as string;
    const agentPubKey = this._privateKey.toPublicKey().toString();

    const authMsg = {
      type: "bridge_auth" as const,
      id: randomUUID(),
      ts: Date.now() * 1_000_000,
      version: PROTOCOL_VERSION,
      agentPubKey,
      signature: signatureHex,
      nonce,
      timestamp,
    };

    this.rawSend(authMsg);
  }

  /**
   * Handle bridge_auth_ok: store venue info, transition through CONNECTED -> SYNCHRONIZING.
   */
  private handleAuthOk(msg: Record<string, unknown>): void {
    // AUTHENTICATING -> CONNECTED
    this.transition(ConnectionState.CONNECTED);

    this._venueInfo = {
      agentId: msg.agentId as string,
      venue: msg.venue as string,
      mode: msg.mode as string,
      instruments: msg.instruments as string[],
    };

    this.emit("authenticated", { ...this._venueInfo });

    // CONNECTED -> SYNCHRONIZING
    this.transition(ConnectionState.SYNCHRONIZING);
    this.startSyncBuffering();
    this.emit("synchronizing");
  }

  /**
   * Handle auth_failed: set auth-failed flag, close connection, do NOT reconnect.
   */
  private handleAuthFailed(msg: Record<string, unknown>): void {
    this._authFailed = true;
    const reason = (msg.reason as string) ?? "unknown";

    // Close WebSocket
    if (this._ws !== null) {
      try {
        this._ws.close(1000, "auth failed");
      } catch {
        // Ignore close errors
      }
      this._ws = null;
    }

    // Transition to DISCONNECTED
    if (this._state !== ConnectionState.DISCONNECTED) {
      this.transition(ConnectionState.DISCONNECTED);
    }

    // Reject all pending requests
    for (const [id, req] of this._pendingRequests) {
      clearTimeout(req.timer);
      req.reject(new Error("Authentication failed"));
      this._pendingRequests.delete(id);
    }

    // Reject queued commands that have pending requests, then clear queue
    for (const queued of this._commandQueue) {
      const pending = this._pendingRequests.get(queued.id);
      if (pending) {
        clearTimeout(pending.timer);
        pending.reject(new Error("Authentication failed"));
        this._pendingRequests.delete(queued.id);
      }
    }
    this._commandQueue = [];

    this.emit("authFailed", { reason });
  }

  /**
   * Handle bridge_ready: transition SYNCHRONIZING -> READY, drain command queue.
   */
  private handleBridgeReady(): void {
    this.transition(ConnectionState.READY);
    this.drainQueue();

    // If this was a reconnection, emit reconnected event and reset counter
    if (this._wasReconnecting) {
      this.emit("reconnected");
      this._wasReconnecting = false;
    }
    this._reconnectAttempt = 0;

    this.emit("ready");
  }

  // ---------------------------------------------------------------------------
  // Heartbeat
  // ---------------------------------------------------------------------------

  /**
   * Handle bridge_ping: reply immediately with bridge_pong and reset heartbeat timer.
   */
  private handlePing(msg: Record<string, unknown>): void {
    const seq = msg.seq as number;
    const serverTs = msg.ts as number;

    const pong = {
      type: "bridge_pong" as const,
      id: randomUUID(),
      ts: Date.now() * 1_000_000,
      version: PROTOCOL_VERSION,
      seq,
      serverTs,
    };

    this.rawSend(pong);
    this.resetHeartbeatTimer();

    const latencyMs =
      serverTs > 0 ? (Date.now() * 1_000_000 - serverTs) / 1_000_000 : 0;
    this.emit("pong", { seq, latencyMs });
  }

  /**
   * Reset the heartbeat timeout timer. If no ping is received within
   * heartbeatInterval * heartbeatTimeout ms, consider the connection dead.
   */
  private resetHeartbeatTimer(): void {
    this.clearHeartbeatTimer();
    const timeoutMs =
      DEFAULT_HEARTBEAT_INTERVAL_MS * this._heartbeatTimeout;
    this._heartbeatTimer = setTimeout(() => {
      this.emit(
        "error",
        new Error(
          `Heartbeat timeout: no ping received for ${timeoutMs}ms`,
        ),
      );
      // Force close -- will trigger onClose -> reconnect
      if (this._ws !== null) {
        try {
          this._ws.close(4000, "heartbeat timeout");
        } catch {
          // Ignore
        }
      }
    }, timeoutMs);
  }

  /** Clear the heartbeat timeout timer. */
  private clearHeartbeatTimer(): void {
    if (this._heartbeatTimer !== null) {
      clearTimeout(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Error response handling
  // ---------------------------------------------------------------------------

  /**
   * Handle err_response: resolve pending request by correlationId or emit error.
   */
  private handleErrResponse(msg: Record<string, unknown>): void {
    const correlationId = msg.correlationId as string | null | undefined;
    if (correlationId && this._pendingRequests.has(correlationId)) {
      // Reject the pending command with the error details
      const pending = this._pendingRequests.get(correlationId);
      if (pending) {
        clearTimeout(pending.timer);
        const errMsg = (msg.message as string) ?? (msg.code as string) ?? "Bridge error";
        console.log(
          `[ConnectionManager] REJECTED command id=${correlationId} type=${pending.type}: ${errMsg}`,
        );
        pending.reject(new Error(`Bridge error [${msg.code ?? "UNKNOWN"}]: ${errMsg}`));
        this._pendingRequests.delete(correlationId);
      }
    } else {
      this.emit("error", msg);
    }
  }

  // ---------------------------------------------------------------------------
  // Command / response correlation
  // ---------------------------------------------------------------------------

  /**
   * Send a command to the bridge and return a Promise that resolves with the
   * correlated response or rejects on timeout.
   */
  sendCommand<T>(
    type: string,
    payload: Record<string, unknown>,
  ): Promise<T> {
    const id = randomUUID();

    return new Promise<T>((resolve, reject) => {
      // If disconnected and no reconnect, reject immediately
      if (
        this._state === ConnectionState.DISCONNECTED &&
        !this._reconnectEnabled
      ) {
        reject(new Error("Connection closed and reconnect is disabled"));
        return;
      }

      // Create timeout timer
      const timer = setTimeout(() => {
        this._pendingRequests.delete(id);
        const err = new TimeoutError(
          `Command ${type} timed out after ${this._commandTimeoutMs}ms`,
          id,
        );
        this.emit("commandTimeout", { commandId: id, type });
        reject(err);
      }, this._commandTimeoutMs);

      // Store pending request
      this._pendingRequests.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
        type,
      });

      // Build message
      const message = {
        type,
        id,
        ts: Date.now() * 1_000_000,
        version: PROTOCOL_VERSION,
        ...payload,
      };

      const serialized = JSON.stringify(message);
      console.log(
        `[ConnectionManager] sendCommand type=${type} id=${id} state=${this._state} wsReady=${this._ws?.readyState}`,
      );
      this.enqueueOrSend(serialized, id);
    });
  }

  /**
   * Resolve a pending command by its correlationId.
   */
  private resolveCommand(
    correlationId: string,
    response: unknown,
  ): void {
    const pending = this._pendingRequests.get(correlationId);
    if (pending) {
      console.log(
        `[ConnectionManager] RESOLVED command id=${correlationId} type=${pending.type} response_type=${(response as Record<string, unknown>)?.type ?? "?"}`,
      );
      clearTimeout(pending.timer);
      pending.resolve(response);
      this._pendingRequests.delete(correlationId);
    } else {
      console.log(
        `[ConnectionManager] resolveCommand: no pending request for id=${correlationId}`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Command queue
  // ---------------------------------------------------------------------------

  /**
   * Send a message immediately if READY or SYNCHRONIZING (sync needs
   * to send get_portfolio), or queue it for later.
   */
  private enqueueOrSend(payload: string, id: string): void {
    if (
      (this._state === ConnectionState.READY ||
        this._state === ConnectionState.SYNCHRONIZING) &&
      this._ws !== null &&
      this._ws.readyState === WebSocket.OPEN
    ) {
      console.log(
        `[ConnectionManager] SENDING immediately id=${id} (${payload.length} bytes)`,
      );
      this._ws.send(payload);
    } else if (this._commandQueue.length >= this._commandQueueMax) {
      // Reject the pending request for this command
      const pending = this._pendingRequests.get(id);
      if (pending) {
        clearTimeout(pending.timer);
        pending.reject(
          new Error(
            "Command queue full -- bridge may be permanently unreachable",
          ),
        );
        this._pendingRequests.delete(id);
      }
    } else {
      console.log(
        `[ConnectionManager] QUEUED command id=${id} (state=${this._state}, wsReady=${this._ws?.readyState}, queueLen=${this._commandQueue.length})`,
      );
      this._commandQueue.push({ payload, id });
    }
  }

  /**
   * Drain all queued commands now that we are READY.
   */
  private drainQueue(): void {
    while (
      this._commandQueue.length > 0 &&
      this._state === ConnectionState.READY &&
      this._ws !== null &&
      this._ws.readyState === WebSocket.OPEN
    ) {
      const item = this._commandQueue.shift()!;
      this._ws.send(item.payload);
    }
  }

  // ---------------------------------------------------------------------------
  // Raw send
  // ---------------------------------------------------------------------------

  /** Serialize and send a message object over the WebSocket. */
  private rawSend(msg: object): void {
    if (this._ws !== null && this._ws.readyState === WebSocket.OPEN) {
      this._ws.send(JSON.stringify(msg));
    }
  }

  // ---------------------------------------------------------------------------
  // WebSocket close handler
  // ---------------------------------------------------------------------------

  private onClose(code: number, reason: string): void {
    this._ws = null;
    this.clearHeartbeatTimer();

    // If manual disconnect already handled transition, skip
    if (this._manualDisconnect) {
      return;
    }

    // Transition to DISCONNECTED
    if (this._state !== ConnectionState.DISCONNECTED) {
      this.transition(ConnectionState.DISCONNECTED);
    }

    this.emit("disconnected", { reason: reason || `code ${code}`, code });

    // Schedule reconnection if appropriate
    if (this._reconnectEnabled && !this._authFailed && !this._manualDisconnect) {
      this.scheduleReconnect();
    }
  }

  // ---------------------------------------------------------------------------
  // Reconnection
  // ---------------------------------------------------------------------------

  /**
   * Schedule a reconnection attempt with exponential backoff.
   * Backoff sequence: [0, 1000, 2000, 4000, 8000] capped at maxDelay (15s).
   */
  private scheduleReconnect(): void {
    if (this._authFailed || this._manualDisconnect || !this._reconnectEnabled) {
      return;
    }

    const index = Math.min(
      this._reconnectAttempt,
      this._backoffDelays.length - 1,
    );
    const delay = Math.min(
      this._backoffDelays[index],
      this._maxReconnectDelay,
    );

    this.emit("reconnecting", {
      attempt: this._reconnectAttempt,
      delay,
    });

    this._reconnectAttempt++;

    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      try {
        this.connect();
      } catch (err) {
        this.emit("error", err);
        // Schedule another attempt
        this.scheduleReconnect();
      }
    }, delay);
  }

  // ---------------------------------------------------------------------------
  // Subscription registry
  // ---------------------------------------------------------------------------

  /**
   * Register an active subscription for re-subscription on reconnect.
   */
  registerSubscription(
    type: string,
    instrumentId: string,
    timeframe?: string,
  ): void {
    const key = timeframe
      ? `${type}:${instrumentId}:${timeframe}`
      : `${type}:${instrumentId}`;
    this._activeSubscriptions.add(key);
  }

  /**
   * Unregister a subscription.
   */
  unregisterSubscription(
    type: string,
    instrumentId: string,
    timeframe?: string,
  ): void {
    const key = timeframe
      ? `${type}:${instrumentId}:${timeframe}`
      : `${type}:${instrumentId}`;
    this._activeSubscriptions.delete(key);
  }

  /**
   * Get all active subscriptions (parsed from the serialized set).
   */
  getActiveSubscriptions(): Array<{
    type: string;
    instrumentId: string;
    timeframe?: string;
  }> {
    const result: Array<{
      type: string;
      instrumentId: string;
      timeframe?: string;
    }> = [];
    for (const key of this._activeSubscriptions) {
      const parts = key.split(":");
      if (parts.length === 3) {
        result.push({
          type: parts[0],
          instrumentId: parts[1],
          timeframe: parts[2],
        });
      } else if (parts.length === 2) {
        result.push({ type: parts[0], instrumentId: parts[1] });
      }
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // Sync event buffering
  // ---------------------------------------------------------------------------

  /**
   * Begin buffering events during SYNCHRONIZING state.
   * Events (orderEvent, positionEvent, dataBar) are stored instead of emitted.
   */
  startSyncBuffering(): void {
    this._syncBuffering = true;
    this._syncEventBuffer = [];
  }

  /**
   * Flush the sync event buffer and stop buffering.
   * Returns all buffered events in order.
   */
  flushSyncBuffer(): Array<unknown> {
    this._syncBuffering = false;
    const events = this._syncEventBuffer;
    this._syncEventBuffer = [];
    return events;
  }
}
