/**
 * Bridge protocol message types as Zod schemas.
 *
 * These schemas mirror the Python msgspec Struct definitions in
 * NautilusBridge/src/protocol.py. All field names use camelCase
 * matching the JSON wire format. The "type" field acts as a
 * discriminator for message unions.
 */

import { z } from "zod";

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
  venues: z.array(z.string()),
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
]);
export type BridgeToAgentMessage = z.infer<typeof BridgeToAgentMessageSchema>;

/**
 * Messages sent from the agent to the bridge.
 */
export const AgentToBridgeMessageSchema = z.discriminatedUnion("type", [
  BridgeAuthSchema,
  BridgePongSchema,
  ListInstrumentsQuerySchema,
]);
export type AgentToBridgeMessage = z.infer<typeof AgentToBridgeMessageSchema>;
