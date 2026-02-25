/**
 * Bridge protocol message types as Zod schemas.
 *
 * These schemas mirror the Python msgspec Struct definitions in
 * NautilusBridge/src/protocol.py. All field names use camelCase
 * matching the JSON wire format. The "type" field acts as a
 * discriminator for message unions.
 */

import { z } from "zod";
import type { PrivateKey } from "@bsv/sdk";

// ---------------------------------------------------------------------------
// Protocol version
// ---------------------------------------------------------------------------

export const PROTOCOL_VERSION = "1.0" as const;

// ---------------------------------------------------------------------------
// Shared enums / types
// ---------------------------------------------------------------------------

export const SeveritySchema = z.enum(["RECOVERABLE", "TRANSIENT", "FATAL"]);
export type Severity = z.infer<typeof SeveritySchema>;

export const HealthStatusSchema = z.enum(["healthy", "degraded", "unhealthy"]);
export type HealthStatus = z.infer<typeof HealthStatusSchema>;

// ---------------------------------------------------------------------------
// Auth flow
// ---------------------------------------------------------------------------

export const BridgeHelloSchema = z.object({
  type: z.literal("bridge_hello"),
  id: z.string(),
  ts: z.number().int(),
  version: z.string(),
  nonce: z.string(),
  capabilities: z.array(z.string()),
});
export type BridgeHello = z.infer<typeof BridgeHelloSchema>;

export const BridgeAuthSchema = z.object({
  type: z.literal("bridge_auth"),
  id: z.string(),
  ts: z.number().int(),
  version: z.string(),
  agentPubKey: z.string(),
  signature: z.string(),
  nonce: z.string(),
  timestamp: z.number().int(),
});
export type BridgeAuth = z.infer<typeof BridgeAuthSchema>;

export const BridgeAuthOkSchema = z.object({
  type: z.literal("bridge_auth_ok"),
  id: z.string(),
  ts: z.number().int(),
  version: z.string(),
  agentId: z.string(),
  venue: z.string(),
  mode: z.string(),
  instruments: z.array(z.string()),
});
export type BridgeAuthOk = z.infer<typeof BridgeAuthOkSchema>;

export const AuthFailedSchema = z.object({
  type: z.literal("auth_failed"),
  id: z.string(),
  ts: z.number().int(),
  version: z.string(),
  reason: z.string(),
});
export type AuthFailed = z.infer<typeof AuthFailedSchema>;

// ---------------------------------------------------------------------------
// Connection lifecycle
// ---------------------------------------------------------------------------

export const BridgeReadySchema = z.object({
  type: z.literal("bridge_ready"),
  id: z.string(),
  ts: z.number().int(),
  version: z.string(),
});
export type BridgeReady = z.infer<typeof BridgeReadySchema>;

export const BridgeDisconnectingSchema = z.object({
  type: z.literal("bridge_disconnecting"),
  id: z.string(),
  ts: z.number().int(),
  version: z.string(),
  reason: z.string(),
});
export type BridgeDisconnecting = z.infer<typeof BridgeDisconnectingSchema>;

// ---------------------------------------------------------------------------
// Heartbeat
// ---------------------------------------------------------------------------

export const BridgePingSchema = z.object({
  type: z.literal("bridge_ping"),
  id: z.string(),
  ts: z.number().int(),
  version: z.string(),
  seq: z.number().int(),
});
export type BridgePing = z.infer<typeof BridgePingSchema>;

export const BridgePongSchema = z.object({
  type: z.literal("bridge_pong"),
  id: z.string(),
  ts: z.number().int(),
  version: z.string(),
  seq: z.number().int(),
  serverTs: z.number().int(),
});
export type BridgePong = z.infer<typeof BridgePongSchema>;

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

export const VenueStatusSchema = z.object({
  venue: z.string(),
  reachable: z.boolean(),
  lastSuccessTs: z.number().int().nullable(),
  connectionState: z.string(),
});
export type VenueStatus = z.infer<typeof VenueStatusSchema>;

export const RateLimitHeadroomSchema = z.object({
  commandType: z.string(),
  current: z.number().int(),
  limit: z.number().int(),
  windowMs: z.number().int(),
});
export type RateLimitHeadroom = z.infer<typeof RateLimitHeadroomSchema>;

export const BridgeHealthSchema = z.object({
  type: z.literal("bridge_health"),
  id: z.string(),
  ts: z.number().int(),
  version: z.string(),
  status: HealthStatusSchema,
  venueConnectivity: z.array(VenueStatusSchema),
  bridgeUptimeS: z.number().int(),
  memoryUsageMb: z.number(),
  rateLimitHeadroom: z.array(RateLimitHeadroomSchema),
  connectedClients: z.number().int(),
  connectedDurationS: z.number().int(),
});
export type BridgeHealth = z.infer<typeof BridgeHealthSchema>;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export const ErrResponseSchema = z.object({
  type: z.literal("err_response"),
  id: z.string(),
  ts: z.number().int(),
  version: z.string(),
  correlationId: z.string().nullable().optional(),
  code: z.string(),
  severity: SeveritySchema,
  message: z.string(),
  retryAfterMs: z.number().int().nullable().optional(),
  current: z.number().int().nullable().optional(),
  limit: z.number().int().nullable().optional(),
  windowMs: z.number().int().nullable().optional(),
  suggestedAction: z.string().nullable().optional(),
  originalCommand: z.record(z.string(), z.unknown()).nullable().optional(),
});
export type ErrResponse = z.infer<typeof ErrResponseSchema>;

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const ListInstrumentsQuerySchema = z.object({
  type: z.literal("list_instruments"),
  id: z.string(),
  ts: z.number().int(),
  version: z.string(),
});
export type ListInstrumentsQuery = z.infer<typeof ListInstrumentsQuerySchema>;

export const InstrumentInfoSchema = z.object({
  symbol: z.string(),
  venue: z.string(),
  tickSize: z.string(),
  lotSize: z.string(),
  minQuantity: z.string(),
  maxQuantity: z.string(),
  assetClass: z.string(),
  venueDetails: z.record(z.string(), z.unknown()).nullable().optional(),
});
export type InstrumentInfo = z.infer<typeof InstrumentInfoSchema>;

export const ListInstrumentsResponseSchema = z.object({
  type: z.literal("list_instruments_response"),
  id: z.string(),
  ts: z.number().int(),
  version: z.string(),
  correlationId: z.string(),
  instruments: z.array(InstrumentInfoSchema),
});
export type ListInstrumentsResponse = z.infer<
  typeof ListInstrumentsResponseSchema
>;

// ---------------------------------------------------------------------------
// Phase 2: Order Commands (agent -> bridge)
// ---------------------------------------------------------------------------

export const SubmitOrderCmdSchema = z.object({
  type: z.literal("submit_order"),
  id: z.string(),
  ts: z.number().int(),
  version: z.string(),
  symbol: z.string(),
  orderSide: z.string(),
  orderType: z.string(),
  quantity: z.string(),
  price: z.string().nullable().optional(),
  triggerPrice: z.string().nullable().optional(),
  timeInForce: z.string().nullable().optional(),
  postOnly: z.boolean().nullable().optional(),
  clientOrderId: z.string().nullable().optional(),
});
export type SubmitOrderCmd = z.infer<typeof SubmitOrderCmdSchema>;

export const CancelOrderCmdSchema = z.object({
  type: z.literal("cancel_order"),
  id: z.string(),
  ts: z.number().int(),
  version: z.string(),
  clientOrderId: z.string(),
});
export type CancelOrderCmd = z.infer<typeof CancelOrderCmdSchema>;

export const ModifyOrderCmdSchema = z.object({
  type: z.literal("modify_order"),
  id: z.string(),
  ts: z.number().int(),
  version: z.string(),
  clientOrderId: z.string(),
  quantity: z.string().nullable().optional(),
  price: z.string().nullable().optional(),
  triggerPrice: z.string().nullable().optional(),
});
export type ModifyOrderCmd = z.infer<typeof ModifyOrderCmdSchema>;

// ---------------------------------------------------------------------------
// Phase 2: Safety Commands (agent -> bridge)
// ---------------------------------------------------------------------------

export const EmergencyHaltCmdSchema = z.object({
  type: z.literal("emergency_halt"),
  id: z.string(),
  ts: z.number().int(),
  version: z.string(),
  reason: z.string().nullable().optional(),
  cancelOrders: z.boolean().nullable().optional(),
  closePositions: z.boolean().nullable().optional(),
});
export type EmergencyHaltCmd = z.infer<typeof EmergencyHaltCmdSchema>;

export const ResumeTradingCmdSchema = z.object({
  type: z.literal("resume_trading"),
  id: z.string(),
  ts: z.number().int(),
  version: z.string(),
  reason: z.string().nullable().optional(),
});
export type ResumeTradingCmd = z.infer<typeof ResumeTradingCmdSchema>;

// ---------------------------------------------------------------------------
// Phase 2: Portfolio Query (agent -> bridge)
// ---------------------------------------------------------------------------

export const GetPortfolioQuerySchema = z.object({
  type: z.literal("get_portfolio"),
  id: z.string(),
  ts: z.number().int(),
  version: z.string(),
});
export type GetPortfolioQuery = z.infer<typeof GetPortfolioQuerySchema>;

// ---------------------------------------------------------------------------
// Phase 2: Portfolio Response (bridge -> agent)
// ---------------------------------------------------------------------------

export const PortfolioResponseSchema = z.object({
  type: z.literal("portfolio_response"),
  id: z.string(),
  ts: z.number().int(),
  version: z.string(),
  correlationId: z.string(),
  accounts: z.array(z.record(z.string(), z.unknown())),
  positions: z.array(z.record(z.string(), z.unknown())),
  openOrders: z.array(z.record(z.string(), z.unknown())),
  riskEngineState: z.string(),
});
export type PortfolioResponse = z.infer<typeof PortfolioResponseSchema>;

// ---------------------------------------------------------------------------
// Phase 2: Order Events (bridge -> agent)
// ---------------------------------------------------------------------------

export const OrderEventSchema = z.object({
  type: z.literal("evt_order"),
  id: z.string(),
  ts: z.number().int(),
  version: z.string(),
  seq: z.number().int(),
  correlationId: z.string().nullable().optional(),
  eventType: z.string(),
  clientOrderId: z.string(),
  instrumentId: z.string(),
  venueOrderId: z.string().nullable().optional(),
  orderSide: z.string(),
  orderType: z.string(),
  quantity: z.string(),
  filledQty: z.string(),
  avgPrice: z.string().nullable().optional(),
  status: z.string(),
  tsEvent: z.number().int(),
  reason: z.string().nullable().optional(),
});
export type OrderEvent = z.infer<typeof OrderEventSchema>;

// ---------------------------------------------------------------------------
// Phase 2: Position Events (bridge -> agent)
// ---------------------------------------------------------------------------

export const PositionEventSchema = z.object({
  type: z.literal("evt_position"),
  id: z.string(),
  ts: z.number().int(),
  version: z.string(),
  seq: z.number().int(),
  correlationId: z.string().nullable().optional(),
  eventType: z.string(),
  positionId: z.string(),
  instrumentId: z.string(),
  side: z.string(),
  quantity: z.string(),
  avgOpenPrice: z.string(),
  unrealizedPnl: z.string(),
  realizedPnl: z.string(),
  currentPrice: z.string().nullable().optional(),
  entryPrice: z.string(),
  tsEvent: z.number().int(),
});
export type PositionEvent = z.infer<typeof PositionEventSchema>;

// ---------------------------------------------------------------------------
// Phase 2: Halt Response (bridge -> agent)
// ---------------------------------------------------------------------------

export const HaltResponseSchema = z.object({
  type: z.literal("halt_response"),
  id: z.string(),
  ts: z.number().int(),
  version: z.string(),
  correlationId: z.string(),
  riskEngineState: z.string(),
  reason: z.string(),
  accounts: z.array(z.record(z.string(), z.unknown())),
  positions: z.array(z.record(z.string(), z.unknown())),
  openOrders: z.array(z.record(z.string(), z.unknown())),
  failedCloses: z.array(z.record(z.string(), z.unknown())),
});
export type HaltResponse = z.infer<typeof HaltResponseSchema>;

// ---------------------------------------------------------------------------
// Market Data Subscription Schemas (wire protocol)
// ---------------------------------------------------------------------------

export const SubscribeBarsSchema = z.object({
  type: z.literal("subscribe_bars"),
  id: z.string(),
  ts: z.number().int(),
  version: z.string(),
  instrumentId: z.string(),
  timeframe: z.string(),
});
export type SubscribeBars = z.infer<typeof SubscribeBarsSchema>;

export const UnsubscribeBarsSchema = z.object({
  type: z.literal("unsubscribe_bars"),
  id: z.string(),
  ts: z.number().int(),
  version: z.string(),
  instrumentId: z.string(),
  timeframe: z.string(),
});
export type UnsubscribeBars = z.infer<typeof UnsubscribeBarsSchema>;

export const DataBarEventSchema = z.object({
  type: z.literal("data_bar"),
  id: z.string(),
  ts: z.number().int(),
  version: z.string(),
  seq: z.number().int(),
  instrumentId: z.string(),
  timeframe: z.string(),
  open: z.string(),
  high: z.string(),
  low: z.string(),
  close: z.string(),
  volume: z.string(),
  tsEvent: z.number().int(),
});
export type DataBarEvent = z.infer<typeof DataBarEventSchema>;

// ---------------------------------------------------------------------------
// Client-specific types (TypeScript only, not in Python protocol)
// ---------------------------------------------------------------------------

/**
 * Connection state enum mirroring Python ConnectionStateMachine.
 */
export enum ConnectionState {
  DISCONNECTED = "DISCONNECTED",
  CONNECTING = "CONNECTING",
  AUTHENTICATING = "AUTHENTICATING",
  CONNECTED = "CONNECTED",
  SYNCHRONIZING = "SYNCHRONIZING",
  READY = "READY",
}

/**
 * Valid state transitions for the connection state machine.
 */
export const CONNECTION_TRANSITIONS: Record<
  ConnectionState,
  Set<ConnectionState>
> = {
  [ConnectionState.DISCONNECTED]: new Set([ConnectionState.CONNECTING]),
  [ConnectionState.CONNECTING]: new Set([
    ConnectionState.AUTHENTICATING,
    ConnectionState.DISCONNECTED,
  ]),
  [ConnectionState.AUTHENTICATING]: new Set([
    ConnectionState.CONNECTED,
    ConnectionState.DISCONNECTED,
  ]),
  [ConnectionState.CONNECTED]: new Set([
    ConnectionState.SYNCHRONIZING,
    ConnectionState.DISCONNECTED,
  ]),
  [ConnectionState.SYNCHRONIZING]: new Set([
    ConnectionState.READY,
    ConnectionState.CONNECTED,
    ConnectionState.DISCONNECTED,
  ]),
  [ConnectionState.READY]: new Set([ConnectionState.DISCONNECTED]),
};

/**
 * Configuration for the BridgeClient WebSocket connection.
 */
export interface BridgeClientConfig {
  /** WebSocket URL (default ws://127.0.0.1:9500) */
  url: string;
  /** @bsv/sdk PrivateKey for auth signing */
  privateKey: PrivateKey;
  /** Reconnection settings */
  reconnect?: {
    /** Whether to reconnect automatically (default true) */
    enabled?: boolean;
    /** Maximum reconnect delay in ms (default 15000) */
    maxDelay?: number;
    /** Backoff delay sequence in ms (default [0, 1000, 2000, 4000, 8000]) */
    backoffDelays?: number[];
  };
  /** Command response timeout in ms (default 10000) */
  commandTimeout?: number;
  /** Missed pongs before disconnect (default 3) */
  heartbeatTimeout?: number;
  /** Market data configuration */
  marketData?: {
    /** Bars per instrument/timeframe ring buffer (default 50) */
    ringBufferSize?: number;
  };
  /** Maximum queued commands (default 100) */
  commandQueueMax?: number;
}

/**
 * Error thrown when a command response is not received within the timeout.
 */
export class TimeoutError extends Error {
  public readonly commandId: string;
  constructor(message: string, commandId: string) {
    super(message);
    this.name = "TimeoutError";
    this.commandId = commandId;
  }
}

/**
 * Backpressure stage for flow control.
 */
export enum BackpressureStage {
  NORMAL = "NORMAL",
  WARN = "WARN",
  THROTTLE = "THROTTLE",
  DROP = "DROP",
  DISCONNECT = "DISCONNECT",
}

// ---------------------------------------------------------------------------
// Discriminated unions
// ---------------------------------------------------------------------------

/**
 * Messages sent from the bridge to the agent.
 */
export const BridgeToAgentMessageSchema = z.discriminatedUnion("type", [
  BridgeHelloSchema,
  BridgeAuthOkSchema,
  AuthFailedSchema,
  BridgeReadySchema,
  BridgeDisconnectingSchema,
  BridgePingSchema,
  BridgePongSchema,
  BridgeHealthSchema,
  ErrResponseSchema,
  ListInstrumentsResponseSchema,
  PortfolioResponseSchema,
  OrderEventSchema,
  PositionEventSchema,
  HaltResponseSchema,
  DataBarEventSchema,
]);
export type BridgeToAgentMessage = z.infer<typeof BridgeToAgentMessageSchema>;

/**
 * Messages sent from the agent to the bridge.
 */
export const AgentToBridgeMessageSchema = z.discriminatedUnion("type", [
  BridgeAuthSchema,
  BridgePongSchema,
  ListInstrumentsQuerySchema,
  SubmitOrderCmdSchema,
  CancelOrderCmdSchema,
  ModifyOrderCmdSchema,
  EmergencyHaltCmdSchema,
  ResumeTradingCmdSchema,
  GetPortfolioQuerySchema,
  SubscribeBarsSchema,
  UnsubscribeBarsSchema,
]);
export type AgentToBridgeMessage = z.infer<typeof AgentToBridgeMessageSchema>;
