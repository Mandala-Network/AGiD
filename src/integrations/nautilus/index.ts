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
  // Discriminated unions
  BridgeToAgentMessageSchema,
  AgentToBridgeMessageSchema,
} from "./types.js";

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
  // Union types
  BridgeToAgentMessage,
  AgentToBridgeMessage,
} from "./types.js";
