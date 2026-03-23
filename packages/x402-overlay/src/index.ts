/**
 * x402 Service Registry Overlay Server
 *
 * Runs an overlay-express node with the x402 topic manager and lookup service.
 * Service operators register paid HTTP services on-chain. Clients query the
 * overlay to discover services, compare pricing, and verify operator identity.
 */

import { config } from 'dotenv'
import OverlayExpress from '@bsv/overlay-express'

import { X402TopicManager } from './services/x402/X402TopicManager'
import createX402LookupService from './services/x402/X402LookupServiceFactory'

config()

async function main() {
  const server = new OverlayExpress({
    name: process.env.NODE_NAME || 'x402-registry',
    privateKey: process.env.SERVER_PRIVATE_KEY!,
    hostingURL: process.env.HOSTING_URL!,
    adminToken: process.env.ADMIN_TOKEN!,
  })

  // Configure ARC for transaction broadcasting
  if (process.env.ARC_API_KEY) {
    server.engine.setARC_API_KEY(process.env.ARC_API_KEY)
  }

  // Configure databases
  await server.configureKnex(process.env.KNEX_URL!)
  await server.configureMongo(process.env.MONGO_URL!)

  // Register x402 topic manager and lookup service
  server.configureTopicManager('tm_x402', new X402TopicManager())
  server.configureLookupServiceWithMongo('ls_x402', createX402LookupService)

  // Health and version endpoints
  server.app.get('/health', (_req: any, res: any) => {
    res.json({
      status: 'ok',
      service: 'x402-registry-overlay',
      version: '1.0.0',
    })
  })

  // Start
  const port = parseInt(process.env.PORT || '8080', 10)
  await server.start()
  console.log(`x402 registry overlay running on port ${port}`)
  console.log(`  Topic manager: tm_x402`)
  console.log(`  Lookup service: ls_x402`)
}

main().catch((err) => {
  console.error('Failed to start x402 overlay:', err)
  process.exit(1)
})
