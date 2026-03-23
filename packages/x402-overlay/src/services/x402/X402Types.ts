/**
 * x402 Service Registry — Type Definitions
 */

export interface UTXOReference {
  txid: string
  outputIndex: number
}

export interface EndpointPricing {
  path: string
  method: string
  price: number
  description?: string
  rateLimit?: string
}

export interface PricingInfo {
  currency: string
  endpoints?: EndpointPricing[]
  defaultPrice?: number
  freeEndpoints?: string[]
}

export interface X402Registration {
  hostUrl: string
  name: string
  description: string
  category: string
  pricing: PricingInfo
  capabilities: string[]
  contactUrl: string
  registeredAt: string
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
}

/** Protocol identifier used in PushDrop tokens */
export const X402_PROTOCOL_ID = 'x402-registry-v1'

/** PushDrop protocol parameters */
export const X402_PUSHDROP_PROTOCOL: [number, string] = [1, 'x402-registry']
export const X402_PUSHDROP_KEY_ID = 'registration'
export const X402_BASKET = 'x402-registrations'

/** Field indices in the PushDrop token */
export const FIELD = {
  PROTOCOL: 0,
  HOST_URL: 1,
  NAME: 2,
  DESCRIPTION: 3,
  CATEGORY: 4,
  PRICING: 5,
  CAPABILITIES: 6,
  CONTACT_URL: 7,
  REGISTERED_AT: 8,
} as const
