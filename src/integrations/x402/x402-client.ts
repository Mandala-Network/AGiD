/**
 * x402 Client
 *
 * Thin wrapper around AuthFetch from @bsv/sdk for making authenticated
 * and paid HTTP requests to x402 services. AuthFetch handles BRC-31
 * mutual auth handshake and automatic 402 payment flow.
 */

import { AuthFetch } from '@bsv/sdk'
import type { BRC100Wallet } from '../../types/index.js'

export interface X402ClientConfig {
  registryUrl?: string // default: https://x402agency.com
}

export interface X402ServiceInfo {
  name: string
  url: string
  tagline?: string
}

const DEFAULT_REGISTRY_URL = 'https://x402agency.com'
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

export class X402Client {
  private authFetch: AuthFetch
  private registryUrl: string
  private cachedServices: X402ServiceInfo[] | null = null
  private cacheTimestamp: number = 0

  constructor(wallet: BRC100Wallet, config?: X402ClientConfig) {
    // AuthFetch only calls getPublicKey, createSignature, verifySignature,
    // createAction — all of which BRC100Wallet implements. The extra
    // `originator` parameter in WalletInterface is optional and ignored.
    this.authFetch = new AuthFetch(wallet.asWalletInterface())
    this.registryUrl = config?.registryUrl ?? DEFAULT_REGISTRY_URL
  }

  /**
   * Discover available x402 services from the registry.
   * Uses plain fetch (unauthenticated). Results cached for 5 minutes.
   */
  async discoverServices(): Promise<X402ServiceInfo[]> {
    const now = Date.now()
    if (this.cachedServices && now - this.cacheTimestamp < CACHE_TTL_MS) {
      return this.cachedServices
    }

    const url = `${this.registryUrl}/.well-known/agents`
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Registry discovery failed: ${response.status} ${response.statusText}`)
    }

    const data = await response.json()
    const services: X402ServiceInfo[] = Array.isArray(data)
      ? data.map((entry: any) => ({
          name: entry.name ?? '',
          url: entry.url ?? '',
          tagline: entry.tagline,
        }))
      : []

    this.cachedServices = services
    this.cacheTimestamp = now
    return services
  }

  /**
   * Fetch /.well-known/x402-info from a specific service (unauthenticated).
   */
  async getServiceInfo(baseUrl: string): Promise<Record<string, unknown>> {
    const url = `${baseUrl.replace(/\/$/, '')}/.well-known/x402-info`
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Service info fetch failed: ${response.status} ${response.statusText}`)
    }
    return response.json() as Promise<Record<string, unknown>>
  }

  /**
   * Make an authenticated request with automatic 402 payment handling.
   * AuthFetch handles: mutual auth handshake -> signed request ->
   * 402 detection -> BRC-42 key derivation -> P2PKH tx -> payment retry.
   */
  async request(
    url: string,
    options?: {
      method?: string
      body?: string
      headers?: Record<string, string>
    }
  ): Promise<{ status: number; headers: Record<string, string>; body: string; paid: boolean }> {
    const response = await this.authFetch.fetch(url, {
      method: options?.method ?? 'GET',
      headers: options?.headers,
      body: options?.body,
    })

    // Extract response headers
    const responseHeaders: Record<string, string> = {}
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value
    })

    const body = await response.text()
    const paid = !!responseHeaders['x-bsv-payment']

    return { status: response.status, headers: responseHeaders, body, paid }
  }
}
