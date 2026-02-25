/**
 * NautilusTrader bridge protocol types.
 *
 * Re-exports all Zod schemas and inferred TypeScript types for the
 * AGiD-NautilusTrader bridge protocol.
 */

export {
  // Protocol version
  PROTOCOL_VERSION,
  // Shared enums
  SeveritySchema,
  HealthStatusSchema,
  // Auth flow
  BridgeHelloSchema,
  BridgeAuthSchema,
  BridgeAuthOkSchema,
  AuthFailedSchema,
  // Connection lifecycle
  BridgeReadySchema,
  BridgeDisconnectingSchema,
  // Heartbeat
  BridgePingSchema,
  BridgePongSchema,
  // Health
  VenueStatusSchema,
  RateLimitHeadroomSchema,
  BridgeHealthSchema,
  // Errors
  ErrResponseSchema,
  // Queries
  ListInstrumentsQuerySchema,
  InstrumentInfoSchema,
  ListInstrumentsResponseSchema,
  // Phase 2: Order Commands
  SubmitOrderCmdSchema,
  CancelOrderCmdSchema,
  ModifyOrderCmdSchema,
  // Phase 2: Safety Commands
  EmergencyHaltCmdSchema,
  ResumeTradingCmdSchema,
  // Phase 2: Portfolio
  GetPortfolioQuerySchema,
  PortfolioResponseSchema,
  // Phase 2: Events
  OrderEventSchema,
  PositionEventSchema,
  // Phase 2: Halt Response
  HaltResponseSchema,
  // Market Data Subscriptions
  SubscribeBarsSchema,
  UnsubscribeBarsSchema,
  DataBarEventSchema,
  // Client-specific enums
  ConnectionState,
  CONNECTION_TRANSITIONS,
  BackpressureStage,
  // Client-specific classes
  TimeoutError,
  // Discriminated unions
  BridgeToAgentMessageSchema,
  AgentToBridgeMessageSchema,
} from "./types.js";

// Consumer-facing client
export { BridgeClient } from "./bridge-client.js";

// Connection manager
export { ConnectionManager } from "./connection-manager.js";

// Data layer modules
export { RingBuffer } from "./ring-buffer.js";
export { MarketDataCache } from "./market-data-cache.js";
export {
  BackpressureMonitor,
} from "./backpressure.js";
export type {
  BackpressureConfig,
  BackpressureEvent,
} from "./backpressure.js";
export { PortfolioCache } from "./portfolio-cache.js";
export type {
  AccountState,
  PositionState,
  OrderState,
} from "./portfolio-cache.js";

export type {
  // Shared types
  Severity,
  HealthStatus,
  // Auth flow types
  BridgeHello,
  BridgeAuth,
  BridgeAuthOk,
  AuthFailed,
  // Connection lifecycle types
  BridgeReady,
  BridgeDisconnecting,
  // Heartbeat types
  BridgePing,
  BridgePong,
  // Health types
  VenueStatus,
  RateLimitHeadroom,
  BridgeHealth,
  // Error types
  ErrResponse,
  // Query types
  ListInstrumentsQuery,
  InstrumentInfo,
  ListInstrumentsResponse,
  // Phase 2: Order Command types
  SubmitOrderCmd,
  CancelOrderCmd,
  ModifyOrderCmd,
  // Phase 2: Safety Command types
  EmergencyHaltCmd,
  ResumeTradingCmd,
  // Phase 2: Portfolio types
  GetPortfolioQuery,
  PortfolioResponse,
  // Phase 2: Event types
  OrderEvent,
  PositionEvent,
  // Phase 2: Halt Response type
  HaltResponse,
  // Market Data Subscription types
  SubscribeBars,
  UnsubscribeBars,
  DataBarEvent,
  // Client-specific types
  BridgeClientConfig,
  // Union types
  BridgeToAgentMessage,
  AgentToBridgeMessage,
} from "./types.js";
