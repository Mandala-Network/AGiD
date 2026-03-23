/**
 * x402 Service Registry — Type Definitions
 *
 * Minimal 5-field token: protocol, hostUrl, category, pricing, capabilities.
 * Name, description, contact, and docs are fetched from the host.
 * Identity key comes from PushDrop locking key. Timestamp from the block.
 */

export interface UTXOReference {
  txid: string
  outputIndex: number
}

export interface EndpointPricing {
  path: string
  method: string
  price: number
}

export interface PricingInfo {
  currency: string
  endpoints?: EndpointPricing[]
  defaultPrice?: number
  freeEndpoints?: string[]
}

export interface X402Registration {
  hostUrl: string
  category: string
  pricing: PricingInfo
  capabilities: string[]
  identityKey: string
}

export interface X402Record {
  txid: string
  outputIndex: number
  registration: X402Registration
  createdAt: Date
}

export interface X402LookupQuery {
  category?: string
  capability?: string
  hostUrl?: string
  identityKey?: string
  maxDefaultPrice?: number
}

/** Protocol identifier — field 0 of every registration token */
export const X402_PROTOCOL_ID = 'x402-registry-v1'

/** PushDrop protocol parameters */
export const X402_PUSHDROP_PROTOCOL: [number, string] = [1, 'x402-registry']
export const X402_PUSHDROP_KEY_ID = 'registration'
export const X402_BASKET = 'x402-registrations'

/** Field indices in the 5-field PushDrop token */
export const FIELD = {
  PROTOCOL: 0,
  HOST_URL: 1,
  CATEGORY: 2,
  PRICING: 3,
  CAPABILITIES: 4,
} as const

/** Total number of fields in a valid registration token */
export const FIELD_COUNT = 5
