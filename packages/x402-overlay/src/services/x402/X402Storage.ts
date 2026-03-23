/**
 * x402 Service Registry — MongoDB Storage Manager
 *
 * Persists and queries admitted service registrations.
 */

import type { Collection, Db } from 'mongodb'
import type { UTXOReference, X402Record, X402Registration } from './X402Types'

export class X402Storage {
  private collection: Collection<X402Record>

  constructor(db: Db) {
    this.collection = db.collection<X402Record>('x402_registrations')
    this.ensureIndexes()
  }

  private async ensureIndexes(): Promise<void> {
    try {
      await this.collection.createIndex({ txid: 1, outputIndex: 1 }, { unique: true })
      await this.collection.createIndex({ 'registration.category': 1 })
      await this.collection.createIndex({ 'registration.capabilities': 1 })
      await this.collection.createIndex({ 'registration.hostUrl': 1 })
      await this.collection.createIndex({ 'registration.identityKey': 1 })
      await this.collection.createIndex({ 'registration.name': 'text', 'registration.description': 'text' })
    } catch {
      // Indexes may already exist
    }
  }

  async storeRecord(record: X402Record): Promise<void> {
    await this.collection.updateOne(
      { txid: record.txid, outputIndex: record.outputIndex },
      { $set: record },
      { upsert: true },
    )
  }

  async deleteRecord(txid: string, outputIndex: number): Promise<void> {
    await this.collection.deleteOne({ txid, outputIndex })
  }

  async findByCategory(category: string): Promise<UTXOReference[]> {
    return this.queryRefs({ 'registration.category': category })
  }

  async findByCapability(capability: string): Promise<UTXOReference[]> {
    return this.queryRefs({ 'registration.capabilities': capability })
  }

  async findByHostUrl(hostUrl: string): Promise<UTXOReference[]> {
    return this.queryRefs({ 'registration.hostUrl': hostUrl })
  }

  async findByIdentityKey(identityKey: string): Promise<UTXOReference[]> {
    return this.queryRefs({ 'registration.identityKey': identityKey })
  }

  async findAll(): Promise<UTXOReference[]> {
    return this.queryRefs({})
  }

  async getRegistration(txid: string, outputIndex: number): Promise<X402Registration | null> {
    const record = await this.collection.findOne({ txid, outputIndex })
    return record?.registration ?? null
  }

  private async queryRefs(filter: object): Promise<UTXOReference[]> {
    const records = await this.collection
      .find(filter)
      .project<UTXOReference>({ txid: 1, outputIndex: 1, _id: 0 })
      .toArray()
    return records.map(r => ({ txid: r.txid, outputIndex: r.outputIndex }))
  }
}
