/**
 * x402 Service Registry — Lookup Service
 *
 * Indexes admitted 5-field registration tokens and provides query
 * capabilities: by category, capability, host URL, operator identity key,
 * and max price.
 *
 * Service: ls_x402
 */

import type { LookupService, LookupQuestion, LookupAnswer } from '@bsv/overlay'
import { PushDrop } from '@bsv/sdk'
import { X402Storage } from './X402Storage'
import {
  X402_PROTOCOL_ID,
  FIELD,
  FIELD_COUNT,
  type X402Registration,
  type X402LookupQuery,
  type UTXOReference,
} from './X402Types'

export class X402LookupService implements LookupService {
  readonly admissionMode = 'locking-script'
  readonly spendNotificationMode = 'all'

  private storage: X402Storage

  constructor(storage: X402Storage) {
    this.storage = storage
  }

  /**
   * Called when the topic manager admits an output.
   * Decode the 5-field PushDrop token and store.
   */
  async outputAdmittedByTopic(
    txid: string,
    outputIndex: number,
    outputScript: Buffer,
    topic: string,
  ): Promise<void> {
    try {
      const decoded = PushDrop.decode(outputScript)
      if (!decoded?.fields || decoded.fields.length < FIELD_COUNT) return

      const fields = decoded.fields.map((f: number[]) =>
        Buffer.from(f).toString('utf8'),
      )

      if (fields[FIELD.PROTOCOL] !== X402_PROTOCOL_ID) return

      const identityKey = decoded.lockingPublicKey?.toString() ?? ''

      let pricing: any
      try { pricing = JSON.parse(fields[FIELD.PRICING]) } catch { pricing = {} }

      let capabilities: string[]
      try { capabilities = JSON.parse(fields[FIELD.CAPABILITIES]) } catch { capabilities = [] }

      const registration: X402Registration = {
        hostUrl: fields[FIELD.HOST_URL],
        category: fields[FIELD.CATEGORY],
        pricing,
        capabilities,
        identityKey,
      }

      await this.storage.storeRecord({
        txid,
        outputIndex,
        registration,
        createdAt: new Date(),
      })
    } catch (error) {
      console.error('[X402LookupService] Error processing admitted output:', error)
    }
  }

  async outputSpent(txid: string, outputIndex: number, topic: string): Promise<void> {
    await this.storage.deleteRecord(txid, outputIndex)
  }

  async outputEvicted?(txid: string, outputIndex: number, topic: string): Promise<void> {
    await this.storage.deleteRecord(txid, outputIndex)
  }

  /**
   * Query the registry. Supports category, capability, hostUrl,
   * identityKey, and maxDefaultPrice filters.
   */
  async lookup(question: LookupQuestion): Promise<LookupAnswer> {
    const query = (question as any).query as X402LookupQuery | undefined

    let refs: UTXOReference[]

    if (query?.category && query?.maxDefaultPrice !== undefined) {
      refs = await this.storage.findByCategoryAndMaxPrice(query.category, query.maxDefaultPrice)
    } else if (query?.category) {
      refs = await this.storage.findByCategory(query.category)
    } else if (query?.capability) {
      refs = await this.storage.findByCapability(query.capability)
    } else if (query?.hostUrl) {
      refs = await this.storage.findByHostUrl(query.hostUrl)
    } else if (query?.identityKey) {
      refs = await this.storage.findByIdentityKey(query.identityKey)
    } else {
      refs = await this.storage.findAll()
    }

    return {
      type: 'output-list',
      outputs: refs.map(r => ({
        beef: Buffer.alloc(0),
        outputIndex: r.outputIndex,
      })),
    } as any
  }

  getDocumentation(): string {
    return `# x402 Service Registry Lookup Service (ls_x402)

Indexes x402 paid service registrations for discovery queries.

## Query Types

| Query | Description |
|-------|-------------|
| \`{ "category": "ai" }\` | All services in a category |
| \`{ "capability": "search" }\` | Services with a specific capability |
| \`{ "hostUrl": "https://..." }\` | Exact host lookup |
| \`{ "identityKey": "02..." }\` | All services by an operator |
| \`{ "category": "ai", "maxDefaultPrice": 200 }\` | Price-filtered discovery |
| \`{}\` | All registrations |

Results are UTXO references. Decode PushDrop fields for registration data.
Fetch /.well-known/x402-info from the host for name, description, and docs.`
  }

  getMetaData(): object {
    return {
      name: 'x402 Service Registry',
      shortDescription: 'Discover and verify x402 paid services',
      version: '1.0.0',
    }
  }
}

export default X402LookupService
