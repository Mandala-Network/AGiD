/**
 * x402 Service Registry — Lookup Service Factory
 *
 * Factory function for creating X402LookupService instances with
 * MongoDB storage. Used by overlay-express configureLookupServiceWithMongo().
 */

import type { Db } from 'mongodb'
import { X402LookupService } from './X402LookupService'
import { X402Storage } from './X402Storage'

export default function createX402LookupService(db: Db): X402LookupService {
  const storage = new X402Storage(db)
  return new X402LookupService(storage)
}
