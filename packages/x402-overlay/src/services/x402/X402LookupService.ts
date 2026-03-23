/**
 * x402 Service Registry — Lookup Service
 *
 * Indexes admitted service registrations and provides query capabilities
 * for discovering services by category, capability, host URL, or operator
 * identity key.
 *
 * Service: ls_x402
 */

import type { LookupService, LookupQuestion, LookupAnswer } from '@bsv/overlay'
import { PushDrop } from '@bsv/sdk'
import { X402Storage } from './X402Storage'
import {
  X402_PROTOCOL_ID,
  FIELD,
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
   * Decode the PushDrop token and store the registration.
   */
  async outputAdmittedByTopic(
    txid: string,
    outputIndex: number,
    outputScript: Buffer,
    topic: string,
  ): Promise<void> {
    try {
      const decoded = PushDrop.decode(outputScript)
      if (!decoded || !decoded.fields || decoded.fields.length < 9) return

      const fields = decoded.fields.map((f: number[]) =>
        Buffer.from(f).toString('utf8'),
      )

      if (fields[FIELD.PROTOCOL] !== X402_PROTOCOL_ID) return

      // Extract identity key from PushDrop locking public key
      const identityKey = decoded.lockingPublicKey?.toString() ?? ''

      let pricing: any
      try { pricing = JSON.parse(fields[FIELD.PRICING]) } catch { pricing = {} }

      let capabilities: string[]
      try { capabilities = JSON.parse(fields[FIELD.CAPABILITIES]) } catch { capabilities = [] }

      const registration: X402Registration = {
        hostUrl: fields[FIELD.HOST_URL],
        name: fields[FIELD.NAME],
        description: fields[FIELD.DESCRIPTION],
        category: fields[FIELD.CATEGORY],
        pricing,
        capabilities,
        contactUrl: fields[FIELD.CONTACT_URL] || '',
        registeredAt: fields[FIELD.REGISTERED_AT],
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

  /**
   * Called when a registration UTXO is spent — remove the listing.
   */
  async outputSpent(txid: string, outputIndex: number, topic: string): Promise<void> {
    await this.storage.deleteRecord(txid, outputIndex)
  }

  /**
   * Called when an output is evicted from the overlay.
   */
  async outputEvicted?(txid: string, outputIndex: number, topic: string): Promise<void> {
    await this.storage.deleteRecord(txid, outputIndex)
  }

  /**
   * Query the registry. Supports filtering by category, capability,
   * host URL, and operator identity key. Empty query returns all.
   */
  async lookup(question: LookupQuestion): Promise<LookupAnswer> {
    const query = (question as any).query as X402LookupQuery | undefined

    let refs: UTXOReference[]

    if (query?.category) {
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
        beef: Buffer.alloc(0), // Overlay engine fills this from its UTXO store
        outputIndex: r.outputIndex,
      })),
    } as any
  }

  getDocumentation(): string {
    return `# x402 Service Registry Lookup Service (ls_x402)

Indexes x402 paid service registrations and supports discovery queries.

## Query Types

**By category:**
\`\`\`json
{ "service": "ls_x402", "query": { "category": "ai" } }
\`\`\`

**By capability:**
\`\`\`json
{ "service": "ls_x402", "query": { "capability": "search" } }
\`\`\`

**By host URL:**
\`\`\`json
{ "service": "ls_x402", "query": { "hostUrl": "https://api.example.com" } }
\`\`\`

**By operator identity key:**
\`\`\`json
{ "service": "ls_x402", "query": { "identityKey": "02abc...def" } }
\`\`\`

**All registrations:**
\`\`\`json
{ "service": "ls_x402", "query": {} }
\`\`\`

Results are returned as UTXO references. Decode the PushDrop fields to
reconstruct registration data including host URL, pricing, and capabilities.`
  }

  getMetaData(): object {
    return {
      name: 'x402 Service Registry',
      shortDescription: 'Discover and verify x402 paid services',
      iconURL: '',
      version: '1.0.0',
      informationURL: '',
    }
  }
}

export default X402LookupService
