#!/usr/bin/env tsx
/**
 * Start AGIdentity Universal HTTP API Server
 *
 * Supports BOTH local mode (development) and MPC mode (production)
 *
 * Local Mode:
 *   AGENT_PRIVATE_KEY=<hex>
 *
 * MPC Mode:
 *   MPC_COSIGNER_ENDPOINTS=http://cosigner1:3001,http://cosigner2:3002
 *   MPC_SHARE_SECRET=<secret>
 *   MPC_SHARE_PATH=./agent-mpc-share.json
 */

import 'dotenv/config'
import { createAgentWallet } from './dist/wallet/agent-wallet.js'
import { createProductionMPCWallet, loadMPCConfigFromEnv } from './dist/wallet/mpc-integration.js'
import { createAGIDServer } from './dist/server/auth-server.js'
import { IdentityGate } from './dist/identity/identity-gate.js'
import type { AgentWallet } from './dist/wallet/agent-wallet.js'

console.log('\n' + '='.repeat(70))
console.log('🚀 AGIdentity Universal HTTP API Server')
console.log('   Framework-agnostic identity for ANY AI agent')
console.log('='.repeat(70) + '\n')

async function startUniversalAPI() {
  // Determine wallet mode
  const mpcEndpoints = process.env.MPC_COSIGNER_ENDPOINTS
  const localPrivateKey = process.env.AGENT_PRIVATE_KEY

  let wallet: AgentWallet
  let identityPublicKey: string
  let mode: string

  // ==========================================================================
  // MPC Mode (Production - Threshold Signatures)
  // ==========================================================================
  if (mpcEndpoints) {
    mode = 'MPC (2-of-3 threshold signatures)'
    console.log(`⚙️  Mode: ${mode}`)
    console.log('   ✅ Production-grade security')
    console.log('   ✅ No single point of failure')
    console.log('   ✅ Distributed key shares\n')

    if (!process.env.MPC_SHARE_SECRET) {
      console.error('❌ ERROR: MPC_SHARE_SECRET not set')
      console.error('   Generate one with: openssl rand -hex 32')
      process.exit(1)
    }

    console.log('⚙️  Initializing MPC wallet...')
    const mpcConfig = loadMPCConfigFromEnv()
    const result = await createProductionMPCWallet(mpcConfig)
    wallet = result.wallet as unknown as AgentWallet
    identityPublicKey = result.collectivePublicKey

    if (result.isNewWallet) {
      console.log('✅ DKG complete - new distributed key generated')
    } else {
      console.log('✅ Restored from existing key share')
    }
    console.log(`   Collective Public Key: ${identityPublicKey}\n`)

  // ==========================================================================
  // Local Mode (Development - Single Key)
  // ==========================================================================
  } else if (localPrivateKey) {
    mode = 'Local (single key - DEVELOPMENT ONLY)'
    console.log(`⚙️  Mode: ${mode}`)
    console.log('   ⚠️  WARNING: Do not use in production!')
    console.log('   ⚠️  Single point of failure\n')

    console.log('⚙️  Creating local wallet...')
    const { wallet: localWallet } = await createAgentWallet({
      privateKeyHex: localPrivateKey,
      network: (process.env.AGID_NETWORK as 'mainnet' | 'testnet') || 'testnet',
    })
    wallet = localWallet
    const keyResult = await localWallet.getPublicKey({ identityKey: true })
    identityPublicKey = keyResult.publicKey
    console.log(`✅ Wallet created`)
    console.log(`   Public Key: ${identityPublicKey}\n`)

  } else {
    console.error('❌ ERROR: No wallet configuration found')
    console.error('   Set either:')
    console.error('   - AGENT_PRIVATE_KEY (local mode)')
    console.error('   - MPC_COSIGNER_ENDPOINTS (MPC mode)')
    process.exit(1)
  }

  // ==========================================================================
  // Start HTTP API Server
  // ==========================================================================
  console.log('⚙️  Creating identity gate...')
  const identityGate = new IdentityGate({
    wallet,
    trustedCertifiers: process.env.TRUSTED_CERTIFIERS?.split(',').filter(Boolean) || []
  })
  console.log('✅ Identity gate ready\n')

  console.log('⚙️  Starting HTTP API server...')
  const server = await createAGIDServer({
    wallet,
    identityGate,
    port: parseInt(process.env.AUTH_SERVER_PORT || '3000'),
    trustedCertifiers: process.env.TRUSTED_CERTIFIERS?.split(',').filter(Boolean) || [],
    allowUnauthenticated: true, // Allow public access to /api/* endpoints
    enableLogging: process.env.AGID_SERVER_LOGGING === 'true'
  })

  await server.start()

  // ==========================================================================
  // Success Summary
  // ==========================================================================
  console.log('\n' + '='.repeat(70))
  console.log('✅ AGIdentity Universal API Server Running!')
  console.log('='.repeat(70))
  console.log(`\n📡 Listening on: http://localhost:${process.env.AUTH_SERVER_PORT || '3000'}`)
  console.log(`🔑 Agent Identity: ${identityPublicKey}`)
  console.log(`🔐 Mode: ${mode}`)
  console.log(`🌐 Network: ${process.env.AGID_NETWORK || 'testnet'}`)
  console.log('\n📋 Universal API Endpoints:\n')
  console.log('   GET  /api/identity       - Get agent public key')
  console.log('   POST /api/sign           - Sign a message')
  console.log('   POST /api/encrypt        - Encrypt data')
  console.log('   POST /api/decrypt        - Decrypt data')
  console.log('   GET  /api/balance        - Check wallet balance')
  console.log('   GET  /health             - Server health check')
  console.log('\n🔌 Works with ANY agent framework:')
  console.log('   ✅ OpenClaw, ZeroClaw, PicoClaw')
  console.log('   ✅ Python (LangChain, AutoGPT)')
  console.log('   ✅ Custom agents (any language with HTTP)')
  console.log('\n='.repeat(70) + '\n')

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n\n⚙️  Shutting down...')
    await server.stop()
    console.log('✅ Server stopped\n')
    process.exit(0)
  })
}

startUniversalAPI().catch(error => {
  console.error('\n❌ Failed to start server:', error.message)
  console.error(error.stack)
  process.exit(1)
})
