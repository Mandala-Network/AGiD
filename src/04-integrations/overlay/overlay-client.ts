/**
 * Overlay Client
 *
 * Generic overlay lookup client using LookupResolver from @bsv/sdk.
 * Handles SLAP-based host discovery, parallel querying of reputable hosts,
 * and PushDrop decoding of UTXO outputs — all in one query() call.
 *
 * Works with any overlay topic/service: identity, registry, custom topics, etc.
 */

import {
  LookupResolver,
  Transaction,
  PushDrop,
  Utils,
} from '@bsv/sdk'
import type { LookupResolverConfig } from '@bsv/sdk'

export interface OverlayClientConfig {
  networkPreset?: 'mainnet' | 'testnet' | 'local'
  resolverConfig?: LookupResolverConfig
}

export interface OverlayOutput {
  /** PushDrop fields decoded as UTF-8 strings */
  fields: string[]
  /** Raw PushDrop fields as hex */
  rawFields: string[]
  /** Locking public key (token creator) */
  lockingPublicKey: string
  /** Transaction ID */
  txid: string
  /** Output index */
  outputIndex: number
}

export class OverlayClient {
  private resolver: LookupResolver

  constructor(config?: OverlayClientConfig) {
    this.resolver = new LookupResolver(
      config?.resolverConfig ?? { networkPreset: config?.networkPreset ?? 'mainnet' }
    )
  }

  /**
   * Query any overlay lookup service. LookupResolver handles SLAP-based
   * host discovery, reputation ranking, parallel querying, and deduplication.
   *
   * @param service - Lookup service name (e.g. 'ls_identity', 'ls_basketmap', 'ls_slap')
   * @param query - Service-specific query object
   * @returns Decoded PushDrop outputs from reputable overlay hosts
   */
  async query(service: string, query: Record<string, unknown> = {}): Promise<OverlayOutput[]> {
    const answer = await this.resolver.query({ service, query })
    if (answer.type !== 'output-list') return []

    const results: OverlayOutput[] = []
    for (const output of answer.outputs) {
      try {
        const tx = Transaction.fromBEEF(output.beef)
        const script = tx.outputs[output.outputIndex]?.lockingScript
        if (!script) continue

        const decoded = PushDrop.decode(script)
        results.push({
          fields: decoded.fields.map(f => Utils.toUTF8(f)),
          rawFields: decoded.fields.map(f => Utils.toHex(f)),
          lockingPublicKey: decoded.lockingPublicKey.toString(),
          txid: tx.id('hex'),
          outputIndex: output.outputIndex,
        })
      } catch {
        // Skip outputs that fail to decode (not PushDrop, corrupt, etc.)
        continue
      }
    }
    return results
  }
}
