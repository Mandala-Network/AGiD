#!/usr/bin/env tsx
/**
 * Start AGIdentity HTTP API Server (Without MessageBox)
 *
 * Minimal server startup for testing universal API endpoints.
 * No MessageBox, no OpenClaw gateway - just HTTP API.
 */

import 'dotenv/config'
import { createAgentWallet } from './dist/wallet/agent-wallet.js'
import { createAGIDServer } from './dist/server/auth-server.js'
import { IdentityGate } from './dist/identity/identity-gate.js'

console.log('\n' + '='.repeat(70))
console.log('🚀 Starting AGIdentity HTTP API Server')
console.log('   Universal access for ANY agent framework')
console.log('='.repeat(70) + '\n')

async function startAPIServer() {
  const privateKey = process.env.AGENT_PRIVATE_KEY
  if (!privateKey) {
    console.error('❌ ERROR: AGENT_PRIVATE_KEY not set in .env')
    process.exit(1)
  }

  console.log('⚙️  Creating agent wallet...')
  const { wallet } = await createAgentWallet({
    privateKeyHex: privateKey,
    network: (process.env.AGID_NETWORK as 'mainnet' | 'testnet') || 'testnet'
  })

  const identity = await wallet.getPublicKey({ identityKey: true })
  console.log(`✅ Agent Identity: ${identity.publicKey}`)
  console.log(`   Network: ${process.env.AGID_NETWORK || 'testnet'}\n`)

  console.log('⚙️  Creating identity gate...')
  const identityGate = new IdentityGate({
    wallet,
    trustedCertifiers: process.env.TRUSTED_CERTIFIERS?.split(',').filter(Boolean) || []
  })
  console.log('✅ Identity gate ready\n')

  console.log('⚙️  Starting HTTP server...')
  const server = await createAGIDServer({
    wallet,
    identityGate,
    port: parseInt(process.env.AUTH_SERVER_PORT || '3000'),
    trustedCertifiers: process.env.TRUSTED_CERTIFIERS?.split(',').filter(Boolean) || [],
    allowUnauthenticated: true, // Allow public access to /api/* endpoints
    enableLogging: process.env.AGID_SERVER_LOGGING === 'true'
  })

  await server.start()

  console.log('\n' + '='.repeat(70))
  console.log('✅ AGIdentity HTTP API Server Running!')
  console.log('='.repeat(70))
  console.log(`\n📡 Listening on: http://localhost:${process.env.AUTH_SERVER_PORT || '3000'}`)
  console.log(`🔑 Agent Identity: ${identity.publicKey}`)
  console.log(`🌐 Network: ${process.env.AGID_NETWORK || 'testnet'}`)
  console.log('\n📋 Available API Endpoints:\n')
  console.log('   GET  /api/identity       - Get agent public key')
  console.log('   POST /api/sign           - Sign a message')
  console.log('   POST /api/encrypt        - Encrypt data')
  console.log('   POST /api/decrypt        - Decrypt data')
  console.log('   GET  /api/balance        - Check wallet balance')
  console.log('   GET  /health             - Server health check')
  console.log('\n🔌 Any agent framework can now connect via HTTP!')
  console.log('   • OpenClaw → HTTP plugin')
  console.log('   • ZeroClaw → HTTP service')
  console.log('   • PicoClaw → HTTP client')
  console.log('   • Custom → Standard HTTP\n')
  console.log('='.repeat(70) + '\n')

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n\n⚙️  Shutting down...')
    await server.stop()
    console.log('✅ Server stopped\n')
    process.exit(0)
  })
}

startAPIServer().catch(error => {
  console.error('\n❌ Failed to start server:', error.message)
  console.error(error.stack)
  process.exit(1)
})
