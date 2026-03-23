/**
 * x402 Registry Client — Types
 */

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

export interface RegistrationParams {
  /** Service base URL (HTTPS required) */
  hostUrl: string
  /** Service category (e.g. "ai", "data", "compute", "storage", "search") */
  category: string
  /** Pricing info — endpoint prices in satoshis */
  pricing: PricingInfo
  /** Capability strings (e.g. ["search", "generate"]) */
  capabilities: string[]
}

export interface RegistrationResult {
  txid: string
  outputIndex: number
  identityKey: string
}

export interface DiscoveredService {
  hostUrl: string
  category: string
  pricing: PricingInfo
  capabilities: string[]
  identityKey: string
  txid: string
  outputIndex: number
}

export interface DiscoverOptions {
  category?: string
  capability?: string
  hostUrl?: string
  identityKey?: string
  maxDefaultPrice?: number
}

/** Protocol constants — must match x402-registry-overlay spec */
export const X402_PROTOCOL_ID = 'x402-registry-v1'
export const X402_TOPIC = 'tm_x402'
export const X402_LOOKUP = 'ls_x402'
export const X402_PROTOCOL: [0 | 1 | 2, string] = [1, 'x402-registry']
export const X402_KEY_ID = 'registration'
export const X402_BASKET = 'x402-registrations'
